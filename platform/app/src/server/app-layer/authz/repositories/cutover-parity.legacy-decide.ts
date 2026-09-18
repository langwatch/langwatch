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
 * So this is the real thing: `hasOrganizationPermission`, the entry point the
 * request path actually calls, asked at ORGANIZATION scope for one member and
 * one permission. `@langwatch/authz-server` cannot import it (a package may
 * not reach into the app), so the migration takes it as a callback the same
 * way it takes its two collectors.
 *
 * Two properties make calling the live entry point safe here rather than
 * reckless:
 *
 *   - It is READ-ONLY. Nothing about asking it changes any row.
 *   - At proof time the organization is by definition NOT on the engine yet -
 *     the whole point of the proof is that it runs before the flip - so the
 *     wrapper's own cutover gate sends it down the legacy body. Which is the
 *     body under test.
 *
 * A synthetic session is what the entry point takes; it carries the user id
 * and nothing else, because that is all the legacy body reads from it.
 */
import { ALL_PERMISSIONS } from "@langwatch/authz";
import type { PrismaClient } from "~/generated/prisma/client";
import { hasOrganizationPermission, type Permission } from "~/server/api/rbac";
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
    return hasOrganizationPermission(
      { prisma, session },
      organizationId,
      permission,
    );
  };
}

function isRegistryPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}
