CREATE TABLE public.b2_download_usage_daily (
    day DATE PRIMARY KEY,
    download_bytes BIGINT NOT NULL DEFAULT 0
);

ALTER TABLE public.b2_download_usage_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.b2_download_usage_daily FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_download_usage(p_bytes BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.b2_download_usage_daily (day, download_bytes)
    VALUES ((now() AT TIME ZONE 'UTC')::DATE, p_bytes)
    ON CONFLICT (day)
    DO UPDATE SET download_bytes =
        public.b2_download_usage_daily.download_bytes + EXCLUDED.download_bytes;
END;
$$;

REVOKE ALL ON FUNCTION public.record_download_usage(BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_download_usage(BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.get_download_usage_today()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT COALESCE(
        (
            SELECT usage.download_bytes
            FROM public.b2_download_usage_daily AS usage
            WHERE usage.day = (now() AT TIME ZONE 'UTC')::DATE
        ),
        0
    )::BIGINT;
$$;

REVOKE ALL ON FUNCTION public.get_download_usage_today() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_download_usage_today() TO authenticated, service_role;
