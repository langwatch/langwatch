-- Drop the old constraint that only knows about userId and groupId
ALTER TABLE "RoleBinding" DROP CONSTRAINT "RoleBinding_principal_check";

-- Re-create with patId as a third valid principal
ALTER TABLE "RoleBinding" ADD CONSTRAINT "RoleBinding_principal_check" CHECK (
    num_nonnulls("userId", "groupId", "patId") = 1
);
