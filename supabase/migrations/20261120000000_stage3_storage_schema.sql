-- ==============================================================================
-- Stage 3: Backblaze B2 Storage, File Uploads, Downloads & Cost Control Schema
-- Description: Creates `global_storage_usage`, `bucket_files`, `upload_reservations`,
--              concurrency-safe atomic quota functions, and Row Level Security.
-- ==============================================================================

-- 1. Create global_storage_usage table (Mandatory single global record)
CREATE TABLE IF NOT EXISTS public.global_storage_usage (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    maximum_bytes BIGINT NOT NULL DEFAULT 9000000000 CHECK (maximum_bytes > 0),
    committed_bytes BIGINT NOT NULL DEFAULT 0 CHECK (committed_bytes >= 0),
    reserved_bytes BIGINT NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the single row if it does not exist
INSERT INTO public.global_storage_usage (id, maximum_bytes, committed_bytes, reserved_bytes)
VALUES (1, 9000000000, 0, 0)
ON CONFLICT (id) DO NOTHING;

-- 2. Create bucket_files table
CREATE TABLE IF NOT EXISTS public.bucket_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id UUID NOT NULL REFERENCES public.buckets(id) ON DELETE CASCADE,
    uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL CHECK (char_length(trim(file_name)) > 0),
    object_key TEXT NOT NULL UNIQUE CHECK (char_length(trim(object_key)) > 0),
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    file_size BIGINT NOT NULL CHECK (file_size > 0),
    checksum TEXT,
    upload_status TEXT NOT NULL DEFAULT 'pending' CHECK (upload_status IN ('pending', 'uploaded', 'deleted', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Create upload_reservations table
CREATE TABLE IF NOT EXISTS public.upload_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id UUID NOT NULL REFERENCES public.buckets(id) ON DELETE CASCADE,
    file_id UUID NOT NULL REFERENCES public.bucket_files(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    reserved_bytes BIGINT NOT NULL CHECK (reserved_bytes > 0),
    reservation_status TEXT NOT NULL DEFAULT 'active' CHECK (reservation_status IN ('active', 'committed', 'aborted', 'expired')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Create indexes for performance and rapid lookup
CREATE INDEX IF NOT EXISTS idx_bucket_files_bucket_id ON public.bucket_files(bucket_id);
CREATE INDEX IF NOT EXISTS idx_bucket_files_uploaded_by ON public.bucket_files(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_bucket_files_status ON public.bucket_files(upload_status);
CREATE INDEX IF NOT EXISTS idx_upload_reservations_user_status ON public.upload_reservations(user_id, reservation_status);
CREATE INDEX IF NOT EXISTS idx_upload_reservations_expires_at ON public.upload_reservations(expires_at);

-- 5. Trigger for bucket_files updated_at
DROP TRIGGER IF EXISTS trg_bucket_files_updated_at ON public.bucket_files;
CREATE TRIGGER trg_bucket_files_updated_at
BEFORE UPDATE ON public.bucket_files
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- 6. Atomic Storage Functions

-- 6.1 Internal helper to clean expired reservations and free reserved quota
CREATE OR REPLACE FUNCTION public.reconcile_expired_reservations_internal()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_freed_bytes BIGINT := 0;
BEGIN
    -- Sum bytes from expired active reservations
    SELECT COALESCE(SUM(reserved_bytes), 0)
    INTO v_freed_bytes
    FROM public.upload_reservations
    WHERE reservation_status = 'active' AND expires_at <= now();

    IF v_freed_bytes > 0 THEN
        -- Mark expired reservations
        UPDATE public.upload_reservations
        SET reservation_status = 'expired'
        WHERE reservation_status = 'active' AND expires_at <= now();

        -- Mark associated pending files as failed
        UPDATE public.bucket_files bf
        SET upload_status = 'failed'
        FROM public.upload_reservations ur
        WHERE ur.file_id = bf.id AND ur.reservation_status = 'expired' AND bf.upload_status = 'pending';

        -- Deduct from global reserved_bytes
        UPDATE public.global_storage_usage
        SET reserved_bytes = GREATEST(0, reserved_bytes - v_freed_bytes),
            updated_at = now()
        WHERE id = 1;
    END IF;
END;
$$;

-- 6.2 Atomic upload reservation function
CREATE OR REPLACE FUNCTION public.reserve_storage(
    p_bucket_id UUID,
    p_user_id UUID,
    p_file_name TEXT,
    p_file_size BIGINT,
    p_mime_type TEXT,
    p_expires_seconds INT DEFAULT 600
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_usage RECORD;
    v_active_user_uploads INT;
    v_file_id UUID := gen_random_uuid();
    v_reservation_id UUID := gen_random_uuid();
    v_object_key TEXT;
    v_expires_at TIMESTAMPTZ;
    v_sanitized_name TEXT;
BEGIN
    -- Input validations
    IF p_file_size <= 0 THEN
        RAISE EXCEPTION 'File size must be greater than zero.';
    END IF;

    -- Lock the global storage record for exclusive atomic quota check
    SELECT * INTO v_usage
    FROM public.global_storage_usage
    WHERE id = 1
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Global storage usage record not found.';
    END IF;

    -- Reconcile any expired reservations first to free up quota
    PERFORM public.reconcile_expired_reservations_internal();

    -- Reload usage after potential reconciliation
    SELECT * INTO v_usage
    FROM public.global_storage_usage
    WHERE id = 1
    FOR UPDATE;

    -- Cost control check: Limit simultaneous active uploads per user to 3
    SELECT COUNT(*) INTO v_active_user_uploads
    FROM public.upload_reservations
    WHERE user_id = p_user_id AND reservation_status = 'active' AND expires_at > now();

    IF v_active_user_uploads >= 3 THEN
        RAISE EXCEPTION 'Upload limit reached. Maximum 3 simultaneous uploads allowed per user.';
    END IF;

    -- Strict Global Storage Limit Check: committed + reserved + requested <= 9,000,000,000
    IF (v_usage.committed_bytes + v_usage.reserved_bytes + p_file_size) > v_usage.maximum_bytes THEN
        RAISE EXCEPTION 'Storage limit reached. Photo De Jaldi currently has no available storage. Please try again later.';
    END IF;

    -- Sanitize filename and construct secure unique object key
    v_sanitized_name := regexp_replace(p_file_name, '[^a-zA-Z0-9._-]', '_', 'g');
    v_object_key := 'buckets/' || p_bucket_id || '/' || v_file_id || '-' || v_sanitized_name;
    v_expires_at := now() + (p_expires_seconds || ' seconds')::interval;

    -- Create pending bucket file
    INSERT INTO public.bucket_files (
        id, bucket_id, uploaded_by, file_name, object_key, mime_type, file_size, upload_status, created_at, updated_at
    ) VALUES (
        v_file_id, p_bucket_id, p_user_id, p_file_name, v_object_key, COALESCE(p_mime_type, 'application/octet-stream'), p_file_size, 'pending', now(), now()
    );

    -- Create active reservation
    INSERT INTO public.upload_reservations (
        id, bucket_id, file_id, user_id, reserved_bytes, reservation_status, expires_at, created_at
    ) VALUES (
        v_reservation_id, p_bucket_id, v_file_id, p_user_id, p_file_size, 'active', v_expires_at, now()
    );

    -- Atomically increase reserved bytes in global quota
    UPDATE public.global_storage_usage
    SET reserved_bytes = reserved_bytes + p_file_size,
        updated_at = now()
    WHERE id = 1;

    RETURN jsonb_build_object(
        'reservation_id', v_reservation_id,
        'file_id', v_file_id,
        'object_key', v_object_key,
        'reserved_bytes', p_file_size,
        'expires_at', v_expires_at
    );
END;
$$;

-- 6.3 Atomic finalize upload function
CREATE OR REPLACE FUNCTION public.finalize_upload(
    p_reservation_id UUID,
    p_actual_size BIGINT,
    p_checksum TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_usage RECORD;
    v_res RECORD;
BEGIN
    -- Lock global storage record
    SELECT * INTO v_usage
    FROM public.global_storage_usage
    WHERE id = 1
    FOR UPDATE;

    -- Lock reservation record
    SELECT * INTO v_res
    FROM public.upload_reservations
    WHERE id = p_reservation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reservation % not found.', p_reservation_id;
    END IF;

    IF v_res.reservation_status <> 'active' THEN
        RAISE EXCEPTION 'Reservation % is already %.', p_reservation_id, v_res.reservation_status;
    END IF;

    -- Mark file as uploaded with confirmed actual size
    UPDATE public.bucket_files
    SET upload_status = 'uploaded',
        file_size = p_actual_size,
        checksum = COALESCE(p_checksum, checksum),
        updated_at = now()
    WHERE id = v_res.file_id;

    -- Mark reservation as committed
    UPDATE public.upload_reservations
    SET reservation_status = 'committed'
    WHERE id = p_reservation_id;

    -- Shift from reserved to committed in global accounting
    UPDATE public.global_storage_usage
    SET reserved_bytes = GREATEST(0, reserved_bytes - v_res.reserved_bytes),
        committed_bytes = committed_bytes + p_actual_size,
        updated_at = now()
    WHERE id = 1;

    RETURN jsonb_build_object(
        'success', true,
        'file_id', v_res.file_id,
        'actual_size', p_actual_size
    );
END;
$$;

-- 6.4 Atomic abort upload function
CREATE OR REPLACE FUNCTION public.abort_upload(
    p_reservation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_res RECORD;
BEGIN
    SELECT * INTO v_res
    FROM public.upload_reservations
    WHERE id = p_reservation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Reservation not found.');
    END IF;

    IF v_res.reservation_status = 'active' THEN
        -- Mark as aborted
        UPDATE public.upload_reservations
        SET reservation_status = 'aborted'
        WHERE id = p_reservation_id;

        -- Mark file as failed
        UPDATE public.bucket_files
        SET upload_status = 'failed',
            updated_at = now()
        WHERE id = v_res.file_id;

        -- Release reserved bytes
        UPDATE public.global_storage_usage
        SET reserved_bytes = GREATEST(0, reserved_bytes - v_res.reserved_bytes),
            updated_at = now()
        WHERE id = 1;
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- 6.5 Atomic delete file storage function
CREATE OR REPLACE FUNCTION public.delete_file_storage(
    p_file_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_file RECORD;
BEGIN
    SELECT * INTO v_file
    FROM public.bucket_files
    WHERE id = p_file_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'File % not found.', p_file_id;
    END IF;

    IF v_file.upload_status = 'uploaded' THEN
        -- Mark file as deleted
        UPDATE public.bucket_files
        SET upload_status = 'deleted',
            updated_at = now()
        WHERE id = p_file_id;

        -- Release committed bytes
        UPDATE public.global_storage_usage
        SET committed_bytes = GREATEST(0, committed_bytes - v_file.file_size),
            updated_at = now()
        WHERE id = 1;

        RETURN jsonb_build_object(
            'success', true,
            'object_key', v_file.object_key,
            'freed_bytes', v_file.file_size
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'object_key', v_file.object_key,
        'freed_bytes', 0
    );
END;
$$;

-- 6.6 Global Storage Usage Retrieval Helper
CREATE OR REPLACE FUNCTION public.get_storage_usage()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
    v_usage RECORD;
    v_avail BIGINT;
    v_pct NUMERIC;
BEGIN
    SELECT * INTO v_usage
    FROM public.global_storage_usage
    WHERE id = 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'maximum_bytes', 9000000000,
            'committed_bytes', 0,
            'reserved_bytes', 0,
            'available_bytes', 9000000000,
            'percent_used', 0,
            'is_limit_reached', false
        );
    END IF;

    v_avail := GREATEST(0, v_usage.maximum_bytes - (v_usage.committed_bytes + v_usage.reserved_bytes));
    v_pct := ROUND(((v_usage.committed_bytes + v_usage.reserved_bytes)::NUMERIC / v_usage.maximum_bytes::NUMERIC) * 100, 2);

    RETURN jsonb_build_object(
        'maximum_bytes', v_usage.maximum_bytes,
        'committed_bytes', v_usage.committed_bytes,
        'reserved_bytes', v_usage.reserved_bytes,
        'available_bytes', v_avail,
        'percent_used', v_pct,
        'is_limit_reached', (v_avail <= 0)
    );
END;
$$;

-- 6.7 Comprehensive storage reconciliation function
CREATE OR REPLACE FUNCTION public.reconcile_storage_accounting()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_real_committed BIGINT := 0;
    v_real_reserved BIGINT := 0;
BEGIN
    -- Reconcile expired active reservations
    PERFORM public.reconcile_expired_reservations_internal();

    -- Lock usage row
    PERFORM 1 FROM public.global_storage_usage WHERE id = 1 FOR UPDATE;

    -- Calculate true committed bytes from uploaded files
    SELECT COALESCE(SUM(file_size), 0)
    INTO v_real_committed
    FROM public.bucket_files
    WHERE upload_status = 'uploaded';

    -- Calculate true reserved bytes from unexpired active reservations
    SELECT COALESCE(SUM(reserved_bytes), 0)
    INTO v_real_reserved
    FROM public.upload_reservations
    WHERE reservation_status = 'active' AND expires_at > now();

    -- Sync global usage
    UPDATE public.global_storage_usage
    SET committed_bytes = v_real_committed,
        reserved_bytes = v_real_reserved,
        updated_at = now()
    WHERE id = 1;

    RETURN jsonb_build_object(
        'success', true,
        'committed_bytes', v_real_committed,
        'reserved_bytes', v_real_reserved,
        'reconciled_at', now()
    );
END;
$$;

-- 7. Secure execution privileges on storage functions
REVOKE ALL ON FUNCTION public.reconcile_expired_reservations_internal() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reserve_storage(UUID, UUID, TEXT, BIGINT, TEXT, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_upload(UUID, BIGINT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.abort_upload(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_file_storage(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_storage_usage() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reconcile_storage_accounting() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_storage_usage() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_storage(UUID, UUID, TEXT, BIGINT, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_upload(UUID, BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abort_upload(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_file_storage(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_storage_accounting() TO authenticated;

-- 8. Secure table permissions (block anon completely, read-only for authenticated)
REVOKE ALL ON TABLE public.global_storage_usage FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.bucket_files FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.upload_reservations FROM PUBLIC, anon;

GRANT SELECT ON TABLE public.global_storage_usage TO authenticated;
GRANT SELECT ON TABLE public.bucket_files TO authenticated;
GRANT SELECT ON TABLE public.upload_reservations TO authenticated;

-- 9. Enable Row Level Security (RLS)
ALTER TABLE public.global_storage_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bucket_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.upload_reservations ENABLE ROW LEVEL SECURITY;

-- 9.1 global_storage_usage RLS policy (authenticated users can read global capacity/usage)
DROP POLICY IF EXISTS "Authenticated users can read global storage usage" ON public.global_storage_usage;
CREATE POLICY "Authenticated users can read global storage usage"
ON public.global_storage_usage
FOR SELECT
TO authenticated
USING (true);

-- 9.2 bucket_files RLS policies
DROP POLICY IF EXISTS "Users can view files in buckets they own or belong to" ON public.bucket_files;
CREATE POLICY "Users can view files in buckets they own or belong to"
ON public.bucket_files
FOR SELECT
TO authenticated
USING (
    public.is_bucket_owner(bucket_id, auth.uid()) OR public.is_bucket_member(bucket_id, auth.uid())
);

-- 9.3 upload_reservations RLS policies
DROP POLICY IF EXISTS "Users can view their own upload reservations" ON public.upload_reservations;
CREATE POLICY "Users can view their own upload reservations"
ON public.upload_reservations
FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
);
