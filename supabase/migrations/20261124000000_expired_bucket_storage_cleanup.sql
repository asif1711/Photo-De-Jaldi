-- Keep expired-bucket storage cleanup server-owned and retryable.
-- Wait 15 minutes after expiry so existing 10-minute presigned upload URLs expire.
ALTER TABLE public.buckets
    ADD COLUMN IF NOT EXISTS cleanup_marked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cleanup_retry_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cleanup_lease_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cleanup_lease_token UUID,
    ADD COLUMN IF NOT EXISTS cleanup_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cleanup_last_error TEXT,
    ADD COLUMN IF NOT EXISTS cleanup_verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cleanup_completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_buckets_expired_cleanup
    ON public.buckets (cleanup_retry_at, cleanup_lease_expires_at, expires_at)
    WHERE status = 'deleting';

CREATE OR REPLACE FUNCTION public.guard_bucket_cleanup_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        IF TG_OP = 'INSERT' THEN
            IF NEW.status = 'deleting'
                OR NEW.cleanup_marked_at IS NOT NULL
                OR NEW.cleanup_retry_at IS NOT NULL
                OR NEW.cleanup_lease_expires_at IS NOT NULL
                OR NEW.cleanup_lease_token IS NOT NULL
                OR NEW.cleanup_attempts <> 0
                OR NEW.cleanup_last_error IS NOT NULL
                OR NEW.cleanup_verified_at IS NOT NULL
                OR NEW.cleanup_completed_at IS NOT NULL THEN
                RAISE EXCEPTION 'Bucket cleanup state is managed by the server.';
            END IF;
        ELSE
            IF OLD.status = 'deleting' AND NEW.status <> 'deleting' THEN
                RAISE EXCEPTION 'A bucket undergoing storage cleanup cannot be reactivated.';
            END IF;
            IF NEW.status = 'active' AND OLD.cleanup_marked_at IS NOT NULL THEN
                RAISE EXCEPTION 'A bucket marked for storage cleanup cannot be reactivated.';
            END IF;
            IF NEW.cleanup_marked_at IS DISTINCT FROM OLD.cleanup_marked_at
                OR NEW.cleanup_retry_at IS DISTINCT FROM OLD.cleanup_retry_at
                OR NEW.cleanup_lease_expires_at IS DISTINCT FROM OLD.cleanup_lease_expires_at
                OR NEW.cleanup_lease_token IS DISTINCT FROM OLD.cleanup_lease_token
                OR NEW.cleanup_attempts IS DISTINCT FROM OLD.cleanup_attempts
                OR NEW.cleanup_last_error IS DISTINCT FROM OLD.cleanup_last_error
                OR NEW.cleanup_verified_at IS DISTINCT FROM OLD.cleanup_verified_at
                OR NEW.cleanup_completed_at IS DISTINCT FROM OLD.cleanup_completed_at THEN
                RAISE EXCEPTION 'Bucket cleanup state is managed by the server.';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_bucket_cleanup_state ON public.buckets;
CREATE TRIGGER trg_guard_bucket_cleanup_state
BEFORE INSERT OR UPDATE ON public.buckets
FOR EACH ROW
EXECUTE FUNCTION public.guard_bucket_cleanup_state();

CREATE OR REPLACE FUNCTION public.mark_expired_buckets_for_cleanup(p_limit INTEGER DEFAULT 50)
RETURNS TABLE(bucket_id UUID, cleanup_after TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH candidates AS (
        SELECT b.id
        FROM public.buckets AS b
        WHERE (b.status IN ('active', 'expired')
                OR (b.status = 'deleting' AND b.cleanup_marked_at IS NULL))
          AND b.expires_at <= now()
          AND b.cleanup_completed_at IS NULL
        ORDER BY b.expires_at, b.id
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.buckets AS b
    SET status = 'deleting',
        cleanup_marked_at = now(),
        cleanup_retry_at = now() + INTERVAL '15 minutes',
        cleanup_last_error = NULL
    FROM candidates
    WHERE b.id = candidates.id
    RETURNING b.id, b.cleanup_retry_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_expired_buckets_for_cleanup(
    p_limit INTEGER DEFAULT 3,
    p_lease_seconds INTEGER DEFAULT 300
)
RETURNS TABLE(bucket_id UUID, cleanup_attempts INTEGER, lease_token UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH candidates AS (
        SELECT b.id
        FROM public.buckets AS b
        WHERE b.status = 'deleting'
          AND b.expires_at <= now()
          AND b.cleanup_completed_at IS NULL
          AND b.cleanup_marked_at <= now() - INTERVAL '15 minutes'
          AND (b.cleanup_retry_at IS NULL OR b.cleanup_retry_at <= now())
          AND (b.cleanup_lease_expires_at IS NULL OR b.cleanup_lease_expires_at <= now())
        ORDER BY b.cleanup_marked_at, b.expires_at, b.id
        LIMIT LEAST(GREATEST(COALESCE(p_limit, 3), 1), 10)
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.buckets AS b
    SET cleanup_attempts = b.cleanup_attempts + 1,
        cleanup_lease_token = gen_random_uuid(),
        cleanup_lease_expires_at = now()
            + make_interval(secs => LEAST(GREATEST(COALESCE(p_lease_seconds, 300), 60), 900)),
        cleanup_retry_at = NULL
    FROM candidates
    WHERE b.id = candidates.id
    RETURNING b.id, b.cleanup_attempts, b.cleanup_lease_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_expired_bucket_cleanup(
    p_bucket_id UUID,
    p_lease_token UUID,
    p_error TEXT,
    p_retry_after_seconds INTEGER DEFAULT 300,
    p_reset_verification BOOLEAN DEFAULT FALSE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.buckets
    SET cleanup_lease_token = NULL,
        cleanup_lease_expires_at = NULL,
        cleanup_retry_at = now()
            + make_interval(secs => LEAST(GREATEST(COALESCE(p_retry_after_seconds, 300), 60), 3600)),
        cleanup_last_error = CASE
            WHEN p_error IS NULL THEN cleanup_last_error
            ELSE LEFT(p_error, 500)
        END,
        cleanup_verified_at = CASE
            WHEN p_reset_verification THEN NULL
            ELSE cleanup_verified_at
        END
    WHERE id = p_bucket_id
      AND status = 'deleting'
      AND cleanup_lease_token = p_lease_token;

    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_expired_bucket_cleanup_verification(
    p_bucket_id UUID,
    p_lease_token UUID,
    p_retry_after_seconds INTEGER DEFAULT 900
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.buckets
    SET cleanup_verified_at = now(),
        cleanup_retry_at = now()
            + make_interval(secs => LEAST(GREATEST(COALESCE(p_retry_after_seconds, 900), 60), 3600)),
        cleanup_lease_expires_at = NULL,
        cleanup_lease_token = NULL,
        cleanup_last_error = NULL
    WHERE id = p_bucket_id
      AND status = 'deleting'
      AND cleanup_lease_token = p_lease_token;

    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_expired_bucket_cleanup(
    p_bucket_id UUID,
    p_lease_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_bucket public.buckets%ROWTYPE;
    v_committed_bytes BIGINT;
    v_reserved_bytes BIGINT;
BEGIN
    SELECT * INTO v_bucket
    FROM public.buckets
    WHERE id = p_bucket_id
    FOR UPDATE;

    IF NOT FOUND
        OR v_bucket.status <> 'deleting'
        OR v_bucket.cleanup_lease_token IS DISTINCT FROM p_lease_token THEN
        RAISE EXCEPTION 'Bucket cleanup lease is no longer valid.';
    END IF;

    SELECT COALESCE(SUM(file_size), 0)
    INTO v_committed_bytes
    FROM public.bucket_files
    WHERE bucket_id = p_bucket_id
      AND upload_status = 'uploaded';

    SELECT COALESCE(SUM(reserved_bytes), 0)
    INTO v_reserved_bytes
    FROM public.upload_reservations
    WHERE bucket_id = p_bucket_id
      AND reservation_status = 'active';

    UPDATE public.global_storage_usage
    SET committed_bytes = GREATEST(0, committed_bytes - v_committed_bytes),
        reserved_bytes = GREATEST(0, reserved_bytes - v_reserved_bytes),
        updated_at = now()
    WHERE id = 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Global storage usage row is missing.';
    END IF;

    UPDATE public.bucket_files
    SET upload_status = 'deleted',
        updated_at = now()
    WHERE bucket_id = p_bucket_id
      AND upload_status <> 'deleted';

    UPDATE public.upload_reservations
    SET reservation_status = 'aborted'
    WHERE bucket_id = p_bucket_id
      AND reservation_status = 'active';

    UPDATE public.multipart_uploads
    SET status = 'aborted',
        updated_at = now()
    WHERE bucket_id = p_bucket_id
      AND status IN ('initiated', 'uploading', 'paused');

    UPDATE public.buckets
    SET status = 'expired',
        cleanup_retry_at = NULL,
        cleanup_lease_expires_at = NULL,
        cleanup_lease_token = NULL,
        cleanup_last_error = NULL,
        cleanup_verified_at = NULL,
        cleanup_completed_at = now()
    WHERE id = p_bucket_id;

    RETURN jsonb_build_object(
        'success', true,
        'freed_committed_bytes', v_committed_bytes,
        'freed_reserved_bytes', v_reserved_bytes
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_active_bucket_upload_reservation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
    v_expires_at TIMESTAMPTZ;
    v_cleanup_marked_at TIMESTAMPTZ;
BEGIN
    IF (TG_OP = 'INSERT' AND NEW.reservation_status = 'active')
        OR (TG_OP = 'UPDATE'
            AND OLD.reservation_status = 'active'
            AND NEW.reservation_status = 'committed') THEN
        SELECT status, expires_at, cleanup_marked_at
        INTO v_status, v_expires_at, v_cleanup_marked_at
        FROM public.buckets
        WHERE id = NEW.bucket_id
        FOR UPDATE;

        IF NOT FOUND
            OR v_status <> 'active'
            OR v_expires_at <= now()
            OR v_cleanup_marked_at IS NOT NULL THEN
            RAISE EXCEPTION 'Cannot create or finalize an upload for an expired bucket.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_active_bucket_upload_reservation ON public.upload_reservations;
CREATE TRIGGER trg_guard_active_bucket_upload_reservation
BEFORE INSERT OR UPDATE ON public.upload_reservations
FOR EACH ROW
EXECUTE FUNCTION public.guard_active_bucket_upload_reservation();

REVOKE ALL ON FUNCTION public.mark_expired_buckets_for_cleanup(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_expired_buckets_for_cleanup(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_expired_bucket_cleanup(UUID, UUID, TEXT, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_expired_bucket_cleanup_verification(UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_expired_bucket_cleanup(UUID, UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mark_expired_buckets_for_cleanup(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_expired_buckets_for_cleanup(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_expired_bucket_cleanup(UUID, UUID, TEXT, INTEGER, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_expired_bucket_cleanup_verification(UUID, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_expired_bucket_cleanup(UUID, UUID) TO service_role;
