-- Fix: the old partial unique indexes used (groupId, role, scopeType, scopeId) which
-- blocks adding two different custom roles at the same scope because both have role="CUSTOM".
-- Replace with two indexes per principal type:
--   • built-in roles  (customRoleId IS NULL)  — keyed on role
--   • custom roles    (customRoleId IS NOT NULL) — keyed on customRoleId instead of role

-- +goose StatementBegin
DROP INDEX IF EXISTS "RoleBinding_user_role_scope_key";
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS "RoleBinding_group_role_scope_key";
-- +goose StatementEnd

-- User bindings — built-in roles
-- +goose StatementBegin
CREATE UNIQUE INDEX "RoleBinding_user_builtin_role_scope_key"
  ON "RoleBinding"("userId", "role", "scopeType", "scopeId")
  WHERE "userId" IS NOT NULL AND "customRoleId" IS NULL;
-- +goose StatementEnd

-- User bindings — custom roles (different customRoleIds are distinct at the same scope)
-- +goose StatementBegin
CREATE UNIQUE INDEX "RoleBinding_user_custom_role_scope_key"
  ON "RoleBinding"("userId", "customRoleId", "scopeType", "scopeId")
  WHERE "userId" IS NOT NULL AND "customRoleId" IS NOT NULL;
-- +goose StatementEnd

-- Group bindings — built-in roles
-- +goose StatementBegin
CREATE UNIQUE INDEX "RoleBinding_group_builtin_role_scope_key"
  ON "RoleBinding"("groupId", "role", "scopeType", "scopeId")
  WHERE "groupId" IS NOT NULL AND "customRoleId" IS NULL;
-- +goose StatementEnd

-- Group bindings — custom roles
-- +goose StatementBegin
CREATE UNIQUE INDEX "RoleBinding_group_custom_role_scope_key"
  ON "RoleBinding"("groupId", "customRoleId", "scopeType", "scopeId")
  WHERE "groupId" IS NOT NULL AND "customRoleId" IS NOT NULL;
-- +goose StatementEnd

-- To roll back, uncomment and run manually:
-- DROP INDEX IF EXISTS "RoleBinding_user_builtin_role_scope_key";
-- DROP INDEX IF EXISTS "RoleBinding_user_custom_role_scope_key";
-- DROP INDEX IF EXISTS "RoleBinding_group_builtin_role_scope_key";
-- DROP INDEX IF EXISTS "RoleBinding_group_custom_role_scope_key";
-- CREATE UNIQUE INDEX "RoleBinding_user_role_scope_key" ON "RoleBinding"("userId", "role", "scopeType", "scopeId") WHERE "userId" IS NOT NULL;
-- CREATE UNIQUE INDEX "RoleBinding_group_role_scope_key" ON "RoleBinding"("groupId", "role", "scopeType", "scopeId") WHERE "groupId" IS NOT NULL;
