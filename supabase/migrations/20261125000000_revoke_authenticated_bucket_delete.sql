DROP POLICY IF EXISTS "Bucket owners can delete their buckets" ON public.buckets;

REVOKE DELETE ON TABLE public.buckets FROM PUBLIC, anon, authenticated;
