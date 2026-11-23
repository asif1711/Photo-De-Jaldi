-- ==============================================================================
-- Stage 3: Multipart Upload Tracking Schema
-- Description: Creates `multipart_uploads` and `multipart_parts` tables to
--              track S3-compatible multipart upload sessions, completed parts,
--              and ETags for pause/resume/cancel functionality.
-- ==============================================================================

-- 1. Create multipart_uploads table
CREATE TABLE IF NOT EXISTS public.multipart_uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reservation_id UUID NOT NULL REFERENCES public.upload_reservations(id) ON DELETE CASCADE,
    bucket_id UUID NOT NULL REFERENCES public.buckets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    object_key TEXT NOT NULL UNIQUE CHECK (char_length(trim(object_key)) > 0),
    upload_id TEXT NOT NULL UNIQUE CHECK (char_length(trim(upload_id)) > 0),
    total_size BIGINT NOT NULL CHECK (total_size > 0),
    part_size BIGINT NOT NULL CHECK (part_size > 0),
    total_parts INT NOT NULL CHECK (total_parts > 0),
    status TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'uploading', 'paused', 'completed', 'aborted', 'expired')),
    completed_parts INT NOT NULL DEFAULT 0 CHECK (completed_parts >= 0),
    uploaded_bytes BIGINT NOT NULL DEFAULT 0 CHECK (uploaded_bytes >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- 2. Create multipart_parts table
CREATE TABLE IF NOT EXISTS public.multipart_parts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    multipart_upload_id UUID NOT NULL REFERENCES public.multipart_uploads(id) ON DELETE CASCADE,
    part_number INT NOT NULL CHECK (part_number > 0),
    etag TEXT NOT NULL CHECK (char_length(trim(etag)) > 0),
    part_size BIGINT NOT NULL CHECK (part_size > 0),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (multipart_upload_id, part_number)
);

-- 3. Create indexes
CREATE INDEX IF NOT EXISTS idx_multipart_uploads_reservation_id ON public.multipart_uploads(reservation_id);
CREATE INDEX IF NOT EXISTS idx_multipart_uploads_user_status ON public.multipart_uploads(user_id, status);
CREATE INDEX IF NOT EXISTS idx_multipart_uploads_expires_at ON public.multipart_uploads(expires_at);
CREATE INDEX IF NOT EXISTS idx_multipart_parts_upload_id ON public.multipart_parts(multipart_upload_id);

-- 4. Trigger for multipart_uploads updated_at
DROP TRIGGER IF EXISTS trg_multipart_uploads_updated_at ON public.multipart_uploads;
CREATE TRIGGER trg_multipart_uploads_updated_at
BEFORE UPDATE ON public.multipart_uploads
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- 5. Atomic function to initiate multipart upload tracking
CREATE OR REPLACE FUNCTION public.create_multipart_upload_tracking(
    p_reservation_id UUID,
    p_bucket_id UUID,
    p_user_id UUID,
    p_object_key TEXT,
    p_upload_id TEXT,
    p_total_size BIGINT,
    p_part_size BIGINT,
    p_total_parts INT,
    p_expires_seconds INT DEFAULT 3600
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_expires_at TIMESTAMPTZ;
    v_upload_id UUID := gen_random_uuid();
BEGIN
    v_expires_at := now() + (p_expires_seconds || ' seconds')::interval;

    INSERT INTO public.multipart_uploads (
        id, reservation_id, bucket_id, user_id, object_key, upload_id,
        total_size, part_size, total_parts, status, completed_parts,
        uploaded_bytes, created_at, updated_at, expires_at
    ) VALUES (
        v_upload_id, p_reservation_id, p_bucket_id, p_user_id, p_object_key,
        p_upload_id, p_total_size, p_part_size, p_total_parts, 'initiated',
        0, 0, now(), now(), v_expires_at
    );

    RETURN jsonb_build_object(
        'multipart_upload_id', v_upload_id,
        'upload_id', p_upload_id,
        'expires_at', v_expires_at
    );
END;
$$;

-- 6. Atomic function to mark a part as completed
CREATE OR REPLACE FUNCTION public.record_multipart_part(
    p_multipart_upload_id UUID,
    p_part_number INT,
    p_etag TEXT,
    p_part_size BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_upload RECORD;
    v_part_exists BOOLEAN;
BEGIN
    -- Lock the multipart upload row
    SELECT * INTO v_upload
    FROM public.multipart_uploads
    WHERE id = p_multipart_upload_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Multipart upload % not found.', p_multipart_upload_id;
    END IF;

    IF v_upload.status <> 'initiated' AND v_upload.status <> 'uploading' AND v_upload.status <> 'paused' THEN
        RAISE EXCEPTION 'Multipart upload % is in % state, cannot record part.', p_multipart_upload_id, v_upload.status;
    END IF;

    -- Check if part already recorded
    SELECT EXISTS (
        SELECT 1 FROM public.multipart_parts
        WHERE multipart_upload_id = p_multipart_upload_id AND part_number = p_part_number
    ) INTO v_part_exists;

    IF v_part_exists THEN
        -- Update existing part ETag and size
        UPDATE public.multipart_parts
        SET etag = p_etag, part_size = p_part_size, uploaded_at = now()
        WHERE multipart_upload_id = p_multipart_upload_id AND part_number = p_part_number;
    ELSE
        -- Insert new part record
        INSERT INTO public.multipart_parts (
            multipart_upload_id, part_number, etag, part_size, uploaded_at
        ) VALUES (
            p_multipart_upload_id, p_part_number, p_etag, p_part_size, now()
        );
    END IF;

    -- Recalculate completed parts and uploaded bytes
    UPDATE public.multipart_uploads
    SET completed_parts = (
        SELECT COUNT(*) FROM public.multipart_parts
        WHERE multipart_upload_id = p_multipart_upload_id
    ),
    uploaded_bytes = (
        SELECT COALESCE(SUM(part_size), 0) FROM public.multipart_parts
        WHERE multipart_upload_id = p_multipart_upload_id
    ),
    status = 'uploading',
    updated_at = now()
    WHERE id = p_multipart_upload_id;

    RETURN jsonb_build_object(
        'success', true,
        'part_number', p_part_number,
        'completed_parts', (
            SELECT COUNT(*) FROM public.multipart_parts
            WHERE multipart_upload_id = p_multipart_upload_id
        ),
        'uploaded_bytes', (
            SELECT COALESCE(SUM(part_size), 0) FROM public.multipart_parts
            WHERE multipart_upload_id = p_multipart_upload_id
        )
    );
END;
$$;

-- 7. Atomic function to pause a multipart upload
CREATE OR REPLACE FUNCTION public.pause_multipart_upload(
    p_multipart_upload_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_upload RECORD;
BEGIN
    SELECT * INTO v_upload
    FROM public.multipart_uploads
    WHERE id = p_multipart_upload_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Multipart upload % not found.', p_multipart_upload_id;
    END IF;

    IF v_upload.status NOT IN ('initiated', 'uploading') THEN
        RAISE EXCEPTION 'Multipart upload % cannot be paused from % state.', p_multipart_upload_id, v_upload.status;
    END IF;

    UPDATE public.multipart_uploads
    SET status = 'paused', updated_at = now()
    WHERE id = p_multipart_upload_id;

    RETURN jsonb_build_object('success', true, 'status', 'paused');
END;
$$;

-- 8. Atomic function to resume a multipart upload
CREATE OR REPLACE FUNCTION public.resume_multipart_upload(
    p_multipart_upload_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_upload RECORD;
BEGIN
    SELECT * INTO v_upload
    FROM public.multipart_uploads
    WHERE id = p_multipart_upload_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Multipart upload % not found.', p_multipart_upload_id;
    END IF;

    IF v_upload.status <> 'paused' THEN
        RAISE EXCEPTION 'Multipart upload % cannot be resumed from % state.', p_multipart_upload_id, v_upload.status;
    END IF;

    IF v_upload.expires_at <= now() THEN
        RAISE EXCEPTION 'Multipart upload % has expired.', p_multipart_upload_id;
    END IF;

    UPDATE public.multipart_uploads
    SET status = 'uploading', updated_at = now()
    WHERE id = p_multipart_upload_id;

    RETURN jsonb_build_object(
        'success', true,
        'status', 'uploading',
        'completed_parts', v_upload.completed_parts,
        'uploaded_bytes', v_upload.uploaded_bytes,
        'total_parts', v_upload.total_parts,
        'total_size', v_upload.total_size
    );
END;
$$;

-- 9. Atomic function to abort a multipart upload
CREATE OR REPLACE FUNCTION public.abort_multipart_upload(
    p_multipart_upload_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_upload RECORD;
BEGIN
    SELECT * INTO v_upload
    FROM public.multipart_uploads
    WHERE id = p_multipart_upload_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Multipart upload % not found.', p_multipart_upload_id;
    END IF;

    IF v_upload.status = 'aborted' THEN
        RETURN jsonb_build_object('success', true, 'status', 'already_aborted');
    END IF;

    IF v_upload.status = 'completed' THEN
        RAISE EXCEPTION 'Cannot abort a completed multipart upload.';
    END IF;

    UPDATE public.multipart_uploads
    SET status = 'aborted', updated_at = now()
    WHERE id = p_multipart_upload_id;

    RETURN jsonb_build_object('success', true, 'status', 'aborted');
END;
$$;

-- 10. Atomic function to complete a multipart upload
CREATE OR REPLACE FUNCTION public.complete_multipart_upload(
    p_multipart_upload_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_upload RECORD;
    v_part_count INT;
BEGIN
    SELECT * INTO v_upload
    FROM public.multipart_uploads
    WHERE id = p_multipart_upload_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Multipart upload % not found.', p_multipart_upload_id;
    END IF;

    IF v_upload.status <> 'uploading' THEN
        RAISE EXCEPTION 'Multipart upload % cannot be completed from % state.', p_multipart_upload_id, v_upload.status;
    END IF;

    SELECT COUNT(*) INTO v_part_count
    FROM public.multipart_parts
    WHERE multipart_upload_id = p_multipart_upload_id;

    IF v_part_count <> v_upload.total_parts THEN
        RAISE EXCEPTION 'Multipart upload % has % parts, expected %.', p_multipart_upload_id, v_part_count, v_upload.total_parts;
    END IF;

    UPDATE public.multipart_uploads
    SET status = 'completed', updated_at = now()
    WHERE id = p_multipart_upload_id;

    RETURN jsonb_build_object(
        'success', true,
        'status', 'completed',
        'object_key', v_upload.object_key,
        'total_size', v_upload.total_size
    );
END;
$$;

-- 11. Get multipart upload status with parts
CREATE OR REPLACE FUNCTION public.get_multipart_upload_status(
    p_multipart_upload_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
    v_upload RECORD;
    v_parts JSONB;
BEGIN
    SELECT * INTO v_upload
    FROM public.multipart_uploads
    WHERE id = p_multipart_upload_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Multipart upload % not found.', p_multipart_upload_id;
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'part_number', part_number,
            'etag', etag,
            'part_size', part_size,
            'uploaded_at', uploaded_at
        )
        ORDER BY part_number
    ), '[]'::jsonb) INTO v_parts
    FROM public.multipart_parts
    WHERE multipart_upload_id = p_multipart_upload_id;

    RETURN jsonb_build_object(
        'multipart_upload_id', v_upload.id,
        'reservation_id', v_upload.reservation_id,
        'upload_id', v_upload.upload_id,
        'object_key', v_upload.object_key,
        'total_size', v_upload.total_size,
        'part_size', v_upload.part_size,
        'total_parts', v_upload.total_parts,
        'status', v_upload.status,
        'completed_parts', v_upload.completed_parts,
        'uploaded_bytes', v_upload.uploaded_bytes,
        'expires_at', v_upload.expires_at,
        'created_at', v_upload.created_at,
        'parts', v_parts
    );
END;
$$;

-- 12. Secure execution privileges
REVOKE ALL ON FUNCTION public.create_multipart_upload_tracking(UUID, UUID, UUID, TEXT, TEXT, BIGINT, BIGINT, INT, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_multipart_part(UUID, INT, TEXT, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pause_multipart_upload(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resume_multipart_upload(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.abort_multipart_upload(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_multipart_upload(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_multipart_upload_status(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_multipart_upload_tracking(UUID, UUID, UUID, TEXT, TEXT, BIGINT, BIGINT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_multipart_part(UUID, INT, TEXT, BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pause_multipart_upload(UUID) TO authenticated;
GRANT EXECUTE ON Function public.resume_multipart_upload(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abort_multipart_upload(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_multipart_upload(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_multipart_upload_status(UUID) TO authenticated;

-- 13. Table permissions
REVOKE ALL ON TABLE public.multipart_uploads FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.multipart_parts FROM PUBLIC, anon;

GRANT SELECT ON TABLE public.multipart_uploads TO authenticated;
GRANT SELECT ON TABLE public.multipart_parts TO authenticated;

-- 14. RLS
ALTER TABLE public.multipart_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.multipart_parts ENABLE ROW LEVEL SECURITY;

-- 14.1 multipart_uploads RLS: owner can view their own uploads
DROP POLICY IF EXISTS "Users can view their own multipart uploads" ON public.multipart_uploads;
CREATE POLICY "Users can view their own multipart uploads"
ON public.multipart_uploads
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- 14.2 multipart_parts RLS: owner can view parts of their own uploads
DROP POLICY IF EXISTS "Users can view parts of their own multipart uploads" ON public.multipart_parts;
CREATE POLICY "Users can view parts of their own multipart uploads"
ON public.multipart_parts
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.multipart_uploads mu
        WHERE mu.id = multipart_parts.multipart_upload_id
        AND mu.user_id = auth.uid()
    )
);
