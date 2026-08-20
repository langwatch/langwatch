/**
 * ADR-092 delivery-plan PR 3 — the parity proof's THIRD leg, composed.
 *
 * The proof's other two legs compare two READERS through one engine, which
 * means every quirk that lives in the legacy RESOLVER rather than in its rows
 * is invisible to them: both sides run the same decision function, so a floor
 * the resolver applies, a fallback it unions, or an order it stops in cancels
 * out of the comparison exactly. That is the half of "will the flip change an
 * answer?" the readers cannot answer.
 *
 * So this is the real thing: the legacy body of `hasOrganizationPermission`,
 * the resolver the request path has been answering this customer from, asked
 * at ORGANIZATION scope for one member and one permission.
 * `@langwatch/authz-server` cannot import it (a package may not reach into
 * the app), so the migration takes it as a callback the same way it takes its
 * two collectors.
 *
 * The LEGACY BODY specifically, not the wrapper around it. The wrapper is a
 * fork: once an organization's cutover fact has landed, it answers from the
 * engine and runs legacy behind it as the reverse-shadow comparison. A proof
 * that called the wrapper would therefore compare the engine with itself the
 * moment a pass re-runs after `completeCutover` landed but the projection
 * wait timed out - and it would report a healthy `resolverSubjectsVerified`
 * while doing it, which is the one failure mode a self-comparison has: it
 * always agrees. Calling `hasOrganizationPermissionLegacy` keeps a re-run
 * meaningful, and skips the wrapper's own shadow comparison, which the proof
 * has no use for.
 *
 * Calling it here is read-only: nothing about asking it changes any row.
 *
 * A synthetic session is what the resolver takes; it carries the user id and
 * nothing else, because that is all the legacy body reads from it.
 */
import { ALL_PERMISSIONS } from "@langwatch/authz";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  hasOrganizationPermissionLegacy,
  type Permission,
} from "~/server/api/rbac";
import type { Session } from "~/server/auth";

/**
 * The callback `GrantsCutoverMigration.legacyDecide` expects, bound to one
 * Prisma handle.
 *
 * An unknown permission answers false rather than throwing: the migration
 * sweeps `ALL_PERMISSIONS`, and the registries on either side of this seam
 * are pinned equal by `authz/__tests__/roles-parity.unit.test.ts`, so a
 * mismatch here would be a registry drift the proof should REPORT, not a
 * crash that parks the tenant.
 */
export function legacyOrganizationDecide(prisma: PrismaClient) {
  return async ({
    userId,
    organizationId,
    permission,
  }: {
    userId: string;
    organizationId: string;
    permission: string;
  }): Promise<boolean> => {
    if (!isRegistryPermission(permission)) return false;
    const session = { user: { id: userId } } as unknown as Session;
    return hasOrganizationPermissionLegacy(
      { prisma, session },
      organizationId,
      permission,
    );
  };
}

function isRegistryPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}
