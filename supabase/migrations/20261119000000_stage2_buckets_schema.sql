-- ==============================================================================
-- Stage 2: Database and Bucket Management Schema
-- Description: Creates `buckets` and `bucket_members` tables with constraints,
--              triggers, indexes, permissions, and Row Level Security (RLS).
-- ==============================================================================

-- 1. Create buckets table
CREATE TABLE IF NOT EXISTS public.buckets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
    description TEXT,
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired', 'deleting')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

-- 2. Create bucket_members table
CREATE TABLE IF NOT EXISTS public.bucket_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id UUID NOT NULL REFERENCES public.buckets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    joined_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_bucket_member UNIQUE (bucket_id, user_id)
);

-- 3. Create indexes for foreign keys and frequent query filters
CREATE INDEX IF NOT EXISTS idx_buckets_created_by ON public.buckets(created_by);
CREATE INDEX IF NOT EXISTS idx_buckets_status ON public.buckets(status);
CREATE INDEX IF NOT EXISTS idx_buckets_expires_at ON public.buckets(expires_at);
CREATE INDEX IF NOT EXISTS idx_bucket_members_bucket_id ON public.bucket_members(bucket_id);
CREATE INDEX IF NOT EXISTS idx_bucket_members_user_id ON public.bucket_members(user_id);

-- 4. Automatically update updated_at timestamp on buckets table
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_buckets_updated_at ON public.buckets;
CREATE TRIGGER trg_buckets_updated_at
BEFORE UPDATE ON public.buckets
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();

-- 5. Helper security definer functions to prevent RLS recursion
CREATE OR REPLACE FUNCTION public.is_bucket_member(p_bucket_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.bucket_members
        WHERE bucket_id = p_bucket_id AND user_id = p_user_id
    );
$$;

CREATE OR REPLACE FUNCTION public.is_bucket_owner(p_bucket_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.buckets
        WHERE id = p_bucket_id AND created_by = p_user_id
    );
$$;

-- 6. Secure function execution privileges
-- Revoke default public execution privileges on security definer functions
REVOKE ALL ON FUNCTION public.is_bucket_member(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_bucket_member(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_bucket_member(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.is_bucket_owner(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_bucket_owner(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_bucket_owner(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.handle_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_updated_at() FROM anon;

-- 7. Secure table permissions (block anon, allow authenticated)
REVOKE ALL ON TABLE public.buckets FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.bucket_members FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.buckets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bucket_members TO authenticated;

-- 8. Enable Row Level Security (RLS)
ALTER TABLE public.buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bucket_members ENABLE ROW LEVEL SECURITY;

-- 9. Policies for buckets table
-- 9.1 SELECT: Owner or invited/joined member can view bucket metadata
DROP POLICY IF EXISTS "Users can view buckets they own or belong to" ON public.buckets;
CREATE POLICY "Users can view buckets they own or belong to"
ON public.buckets
FOR SELECT
TO authenticated
USING (
    created_by = auth.uid() OR public.is_bucket_member(id, auth.uid())
);

-- 9.2 INSERT: Signed-in users can create buckets only where created_by matches their auth.uid()
DROP POLICY IF EXISTS "Users can create buckets for themselves" ON public.buckets;
CREATE POLICY "Users can create buckets for themselves"
ON public.buckets
FOR INSERT
TO authenticated
WITH CHECK (
    created_by = auth.uid()
);

-- 9.3 UPDATE: Only the bucket owner can update bucket metadata
DROP POLICY IF EXISTS "Bucket owners can update their buckets" ON public.buckets;
CREATE POLICY "Bucket owners can update their buckets"
ON public.buckets
FOR UPDATE
TO authenticated
USING (
    created_by = auth.uid()
)
WITH CHECK (
    created_by = auth.uid()
);

-- 9.4 DELETE: Only the bucket owner can delete their bucket
DROP POLICY IF EXISTS "Bucket owners can delete their buckets" ON public.buckets;
CREATE POLICY "Bucket owners can delete their buckets"
ON public.buckets
FOR DELETE
TO authenticated
USING (
    created_by = auth.uid()
);

-- 10. Policies for bucket_members table
-- 10.1 SELECT: Members can view their own membership; bucket owners can view all members
DROP POLICY IF EXISTS "Members and owners can view bucket memberships" ON public.bucket_members;
CREATE POLICY "Members and owners can view bucket memberships"
ON public.bucket_members
FOR SELECT
TO authenticated
USING (
    user_id = auth.uid() OR public.is_bucket_owner(bucket_id, auth.uid())
);

-- 10.2 INSERT: Only bucket owners can add members
DROP POLICY IF EXISTS "Only bucket owners can add members" ON public.bucket_members;
CREATE POLICY "Only bucket owners can add members"
ON public.bucket_members
FOR INSERT
TO authenticated
WITH CHECK (
    public.is_bucket_owner(bucket_id, auth.uid())
);

-- 10.3 UPDATE: Only bucket owners can update member roles
DROP POLICY IF EXISTS "Only bucket owners can update members" ON public.bucket_members;
CREATE POLICY "Only bucket owners can update members"
ON public.bucket_members
FOR UPDATE
TO authenticated
USING (
    public.is_bucket_owner(bucket_id, auth.uid())
)
WITH CHECK (
    public.is_bucket_owner(bucket_id, auth.uid())
);

-- 10.4 DELETE: Bucket owners can remove members; members can remove themselves
DROP POLICY IF EXISTS "Owners can remove members or members can leave" ON public.bucket_members;
CREATE POLICY "Owners can remove members or members can leave"
ON public.bucket_members
FOR DELETE
TO authenticated
USING (
    public.is_bucket_owner(bucket_id, auth.uid()) OR user_id = auth.uid()
);
