/**
 * The one tenant set every budget spend read fans out over.
 *
 * The ledger shards on `TenantId` = the project the request's trace landed
 * in, so an organization, team, principal, or group budget accrues rows
 * under whichever project emitted the call. Any reader that narrows the
 * tenant set differently reports a different number for the same budget,
 * which is how the same cap ended up showing three figures across the /me
 * page, the CLI and the budgets settings page.
 *
 * Archived projects stay in. Their ledger rows still count against the cap
 * the gateway enforces - both `config.materialiser.loadCurrentSpend` (the
 * bundle the gateway blocks on) and the request-time check read every
 * project in the organization - so excluding them would make a surface
 * promise more headroom than the enforcement path actually allows.
 */
import type { PrismaClient } from "~/generated/prisma/client";

export async function organizationSpendTenantIds(
  prisma: PrismaClient,
  organizationId: string,
): Promise<string[]> {
  const projects = await prisma.project.findMany({
    where: { team: { organizationId } },
    select: { id: true },
  });
  return projects.map((p) => p.id);
}
