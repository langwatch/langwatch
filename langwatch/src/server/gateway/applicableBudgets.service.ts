/**
 * "Already applies": the budgets that will constrain a key, answered for
 * a key that may not exist yet.
 *
 * The create drawer has to show this before anything is saved, so the
 * input is a draft: the scopes the creator has picked plus, for a personal
 * key, who it belongs to. The resolution itself is the same call the
 * gateway bundle and the request-time check make, so the list cannot
 * promise a constraint that will not be enforced, or miss one that will.
 *
 * Spend comes from the same rollup the budgets page reads, so a limit and
 * its "spent so far" agree wherever they are shown.
 */
import type { PrismaClient } from "@prisma/client";

import type {
  BudgetSpendTarget,
  GatewayBudgetClickHouseRepository,
} from "./budget.clickhouse.repository";
import {
  type BudgetResolutionTarget,
  resolveApplicableBudgets,
} from "./budgetResolution.service";
import { resolveProviderLabels } from "./providerLabels";
import { resolveTraceProject } from "./scopeResolver";
import { resolveScopeTargetsBatch, scopeTargetKey } from "./scopeTargets";
import type { ScopeInput } from "./virtualKey.repository";

export type DraftVirtualKey = {
  organizationId: string;
  /** Null while the key is still a draft in the drawer. */
  virtualKeyId: string | null;
  scopes: ScopeInput[];
  /** Explicit trace destination for org- and team-owned drafts. */
  traceProjectId: string | null;
  principalUserId: string | null;
};

export type ApplicableBudget = {
  id: string;
  name: string;
  scopeType: string;
  scopeId: string;
  /** Human label for the target, e.g. the team or group name. */
  scopeLabel: string;
  window: string;
  limitUsd: string;
  spentUsd: string;
  onBreach: string;
  /** Null means resets are computed in the default timezone (UTC). */
  timezone: string | null;
  /** Null when the budget counts every provider. */
  providerKey: string | null;
  /** Display name for `providerKey`, so the list can say "OpenAI only". */
  providerLabel: string | null;
  /**
   * True when the budget is per member of a group rather than a
   * shared pot, which changes what its limit means to the person reading.
   */
  isPerMember: boolean;
  /**
   * Set when this row is the budget a key's drawer field manages. The
   * edit drawer seeds its field from this row and hides it from the
   * inherited list; independently created key-targeted budgets show as
   * inherited constraints like any other.
   */
  managedByVirtualKeyId: string | null;
};

export async function resolveApplicableBudgetsForDraftKey(
  prisma: PrismaClient,
  draft: DraftVirtualKey,
  chRepo?: GatewayBudgetClickHouseRepository,
): Promise<ApplicableBudget[]> {
  // Where the draft's traces would land, which is what decides whether
  // team- and project-scoped budgets reach it at all.
  const traceProject = await resolveTraceProject(prisma, {
    organizationId: draft.organizationId,
    scopes: draft.scopes.map((s) => ({
      scopeType: s.scopeType,
      scopeId: s.scopeId,
    })),
    traceProjectId: draft.traceProjectId,
  });

  return await resolveApplicableBudgetsForTarget(
    prisma,
    {
      organizationId: draft.organizationId,
      virtualKeyId: draft.virtualKeyId,
      teamId: traceProject?.teamId ?? null,
      projectId: traceProject?.id ?? null,
      principalUserId: draft.principalUserId,
    },
    chRepo,
  );
}

/**
 * Same decoration for a caller that already knows the exact resolution
 * target (team, project, key, principal) and does not need the draft's
 * trace-project inference. The budget-overview service reads this with
 * the user's personal workspace as the target.
 */
export async function resolveApplicableBudgetsForTarget(
  prisma: PrismaClient,
  target: BudgetResolutionTarget,
  chRepo?: GatewayBudgetClickHouseRepository,
): Promise<ApplicableBudget[]> {
  const resolved = await resolveApplicableBudgets(prisma, target);
  if (resolved.length === 0) return [];

  // Independent lookups on an interactive path: run them together.
  const [spentByBudgetId, targets, providerLabels] = await Promise.all([
    loadSpend(prisma, target.organizationId, resolved, chRepo),
    resolveScopeTargetsBatch(
      prisma,
      resolved.map((r) => r.budget),
      target.organizationId,
    ),
    resolveProviderLabels({
      prisma,
      budgets: resolved.map((r) => r.budget),
    }),
  ]);

  // bucketScopeId stays internal: it is where spend accrues, not the
  // budget's target, and a UI showing "<group>:<user>" would read as one.
  return resolved.map(({ budget }) => ({
    id: budget.id,
    name: budget.name,
    scopeType: budget.scopeType,
    scopeId: budget.scopeId,
    scopeLabel:
      targets.get(scopeTargetKey(budget.scopeType, budget.scopeId))?.name ??
      budget.scopeId,
    window: budget.window,
    limitUsd: budget.limitUsd.toFixed(6),
    spentUsd: spentByBudgetId.get(budget.id) ?? "0",
    onBreach: budget.onBreach,
    timezone: budget.timezone,
    providerKey: budget.providerKey,
    providerLabel: budget.providerKey
      ? (providerLabels.get(budget.providerKey) ?? budget.providerKey)
      : null,
    isPerMember: budget.scopeType === "GROUP",
    managedByVirtualKeyId: budget.managedByVirtualKeyId,
  }));
}

async function loadSpend(
  prisma: PrismaClient,
  organizationId: string,
  resolved: Awaited<ReturnType<typeof resolveApplicableBudgets>>,
  chRepo?: GatewayBudgetClickHouseRepository,
): Promise<Map<string, string>> {
  if (!chRepo) return new Map();
  const projects = await prisma.project.findMany({
    where: { team: { organizationId } },
    select: { id: true },
  });
  if (projects.length === 0) return new Map();
  const targets: BudgetSpendTarget[] = resolved.map((r) => ({
    budgetId: r.budget.id,
    scope: r.budget.scopeType,
    scopeId: r.bucketScopeId,
    window: r.budget.window,
    match: "exact",
  }));
  try {
    const spends = await chRepo.getSpendForTargetsAcrossTenants(
      projects.map((p) => p.id),
      targets,
    );
    return new Map(spends.map((s) => [s.budgetId, s.spentUsd]));
  } catch {
    // Spend is decoration on this list; the budgets themselves are the
    // answer. A rollup outage must not blank the drawer.
    return new Map();
  }
}
