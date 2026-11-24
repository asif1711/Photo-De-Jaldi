CREATE OR REPLACE FUNCTION public.get_file_status_breakdown()
RETURNS TABLE (
    file_status TEXT,
    file_count BIGINT,
    total_bytes BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    WITH categorized_files AS (
        SELECT
            CASE
                WHEN f.upload_status = 'deleted' THEN 'deleted'
                WHEN f.upload_status = 'uploaded'
                    AND (b.status IN ('expired', 'deleting') OR b.expires_at <= now())
                    THEN 'expired'
                WHEN f.upload_status = 'uploaded' THEN 'uploaded'
            END AS file_status,
            f.file_size
        FROM public.bucket_files AS f
        INNER JOIN public.buckets AS b ON b.id = f.bucket_id
        WHERE f.upload_status IN ('uploaded', 'deleted')
    ),
    aggregated AS (
        SELECT
            file_status,
            COUNT(*)::BIGINT AS file_count,
            COALESCE(SUM(file_size), 0)::BIGINT AS total_bytes
        FROM categorized_files
        WHERE file_status IS NOT NULL
        GROUP BY file_status
    ),
    status_rows AS (
        SELECT 'uploaded'::TEXT AS file_status, 1 AS sort_order
        UNION ALL SELECT 'expired', 2
        UNION ALL SELECT 'deleted', 3
    )
    SELECT
        s.file_status,
        COALESCE(a.file_count, 0)::BIGINT,
        COALESCE(a.total_bytes, 0)::BIGINT
    FROM status_rows AS s
    LEFT JOIN aggregated AS a USING (file_status)
    ORDER BY s.sort_order;
$$;

REVOKE ALL ON FUNCTION public.get_file_status_breakdown() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_file_status_breakdown() TO authenticated, service_role;
