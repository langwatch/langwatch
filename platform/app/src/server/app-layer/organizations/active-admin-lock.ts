import { OrganizationUserRole, type Prisma } from "~/generated/prisma/client";

/**
 * Serialize destructive admin decisions on the organization row, then read
 * and lock the administrators who can still sign in. The stable parent-row
 * lock makes a user deactivation committed by a sibling transaction visible
 * before this statement decides whether one admin remains.
 */
export async function lockActiveAdmins({
  tx,
  organizationId,
}: {
  tx: Prisma.TransactionClient;
  organizationId: string;
}): Promise<Array<{ userId: string }>> {
  await tx.$queryRaw<Array<{ id: string }>>`
    -- @tenancy: organization-scoped lock keyed by the requested organization id
    SELECT "id" FROM "Organization"
    WHERE "id" = ${organizationId}
    FOR UPDATE
  `;

  return tx.$queryRaw<Array<{ userId: string }>>`
    SELECT "userId" FROM "OrganizationUser"
    WHERE "organizationId" = ${organizationId}
      AND "role"::text = ${OrganizationUserRole.ADMIN}
      AND "disabledAt" IS NULL
      AND EXISTS (
        SELECT 1 FROM "User"
        WHERE "User"."id" = "OrganizationUser"."userId"
          AND "User"."deactivatedAt" IS NULL
      )
    ORDER BY "userId"
    FOR UPDATE
  `;
}
