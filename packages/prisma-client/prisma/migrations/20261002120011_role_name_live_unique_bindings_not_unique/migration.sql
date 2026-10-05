-- A role name is unique among live roles only, so a deleted role's name can be
-- reused. Grants and role bindings carry no uniqueness at all: the same
-- principal, role and scope may be bound more than once, within the limits.
--
-- Safe in both directions: the previous image refuses those duplicates in the
-- application before it writes, and relies on none of these indexes by name.

-- Role: the name index moves to live rows.
CREATE UNIQUE INDEX "Role_organizationId_name_live_key"
  ON "Role"("organizationId", "name")
  WHERE "deletedAt" IS NULL;
DROP INDEX IF EXISTS "Role_organizationId_name_key";

-- RoleBinding: the six identity indexes go (20260410120000, 20260414222341).
DROP INDEX IF EXISTS "RoleBinding_user_builtin_role_scope_key";
DROP INDEX IF EXISTS "RoleBinding_user_custom_role_scope_key";
DROP INDEX IF EXISTS "RoleBinding_group_builtin_role_scope_key";
DROP INDEX IF EXISTS "RoleBinding_group_custom_role_scope_key";
DROP INDEX IF EXISTS "RoleBinding_apiKey_builtin_role_scope_key";
DROP INDEX IF EXISTS "RoleBinding_apiKey_custom_role_scope_key";
