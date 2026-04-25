-- Rename PersonalAccessToken → ApiKey (metadata-only, preserves all data)
ALTER TABLE "PersonalAccessToken" RENAME TO "ApiKey";

-- Rename RoleBinding column patId → apiKeyId (metadata-only, preserves all values)
ALTER TABLE "RoleBinding" RENAME COLUMN "patId" TO "apiKeyId";

-- Add new columns to ApiKey
ALTER TABLE "ApiKey" ADD COLUMN "permissionMode" TEXT NOT NULL DEFAULT 'all';
ALTER TABLE "ApiKey" ADD COLUMN "createdByUserId" TEXT;

-- Rename primary key constraint
ALTER INDEX "PersonalAccessToken_pkey" RENAME TO "ApiKey_pkey";

-- Rename unique constraint on lookupId
ALTER INDEX "PersonalAccessToken_lookupId_key" RENAME TO "ApiKey_lookupId_key";

-- Rename indexes on ApiKey table
ALTER INDEX "PersonalAccessToken_userId_idx" RENAME TO "ApiKey_userId_idx";
ALTER INDEX "PersonalAccessToken_organizationId_idx" RENAME TO "ApiKey_organizationId_idx";
ALTER INDEX "PersonalAccessToken_lookupId_idx" RENAME TO "ApiKey_lookupId_idx";

-- Rename RoleBinding index for apiKeyId
ALTER INDEX "RoleBinding_patId_idx" RENAME TO "RoleBinding_apiKeyId_idx";

-- Rename partial unique indexes on RoleBinding
ALTER INDEX "RoleBinding_pat_builtin_role_scope_key" RENAME TO "RoleBinding_apiKey_builtin_role_scope_key";
ALTER INDEX "RoleBinding_pat_custom_role_scope_key" RENAME TO "RoleBinding_apiKey_custom_role_scope_key";

-- Update the principal check constraint to reference apiKeyId
ALTER TABLE "RoleBinding" DROP CONSTRAINT "RoleBinding_principal_check";
ALTER TABLE "RoleBinding" ADD CONSTRAINT "RoleBinding_principal_check" CHECK (
    num_nonnulls("userId", "groupId", "apiKeyId") = 1
);
