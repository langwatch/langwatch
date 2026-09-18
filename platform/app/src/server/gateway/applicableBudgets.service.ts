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
import type { PrismaClient } from "~/generated/prisma/client";

import type {
  BudgetSpendTarget,
  GatewayBudgetClickHouseRepository,
} from "./budget.clickhouse.repository";
import { budgetPeriodFloorMs } from "./budgetPeriod";
import { resolveApplicableBudgets } from "./budgetResolution.service";
import { resolveProviderLabels } from "./providerLabels";
import {
  decideTraceDestination,
  type TraceProject,
  traceProjectFor,
} from "./scopeResolver";
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
  // Where this key's traces land, which is what decides whether team- and
  // project-scoped budgets reach it at all.
  //
  // A key that exists has a stored destination, and the answer has to be the
  // one the gateway will act on: the same pointer the materialiser follows,
  // archived or not. Deciding it again here would show an empty list for a
  // key whose destination the customer deleted, while its project and team
  // budgets went on enforcing.
  //
  // A draft has no key row and no stored destination yet, so the honest
  // answer is the decision the save is about to make. A draft the save would
  // refuse previews as no destination, which is what an incomplete form is.
  const traceProject = draft.virtualKeyId
    ? await traceProjectFor(prisma, draft.traceProjectId)
    : await decidedTraceProject({ prisma, draft });

  const resolved = await resolveApplicableBudgets({
    client: prisma,
    target: {
      organizationId: draft.organizationId,
      virtualKeyId: draft.virtualKeyId,
      teamId: traceProject?.teamId ?? null,
      // Passed explicitly rather than read from the key: a draft has no key
      // row yet, and the drawer has to preview the set the key will resolve
      // once it is saved, not the smaller set it can look up today.
      scopedTeamIds: draft.scopes
        .filter((scope) => scope.scopeType === "TEAM")
        .map((scope) => scope.scopeId),
      projectId: traceProject?.id ?? null,
      principalUserId: draft.principalUserId,
    },
  });
  if (resolved.length === 0) return [];

  // Independent lookups on an interactive path: run them together.
  const [spentByBudgetId, labels, providerLabels] = await Promise.all([
    loadSpend(prisma, draft, resolved, chRepo),
    loadScopeLabels(prisma, resolved),
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
      labels.get(`${budget.scopeType}:${budget.scopeId}`) ?? budget.scopeId,
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

/**
 * Where a draft's traces would land once it is saved: the same decision the
 * save will make, so the list cannot preview a destination the key will not
 * get. A draft the save would refuse has none yet.
 */
async function decidedTraceProject({
  prisma,
  draft,
}: {
  prisma: PrismaClient;
  draft: DraftVirtualKey;
}): Promise<TraceProject | null> {
  const decision = await decideTraceDestination(prisma, {
    organizationId: draft.organizationId,
    scopes: draft.scopes.map((s) => ({
      scopeType: s.scopeType,
      scopeId: s.scopeId,
    })),
    traceProjectId: draft.traceProjectId,
  });
  return decision.outcome === "resolved" ? decision.project : null;
}

async function loadSpend(
  prisma: PrismaClient,
  draft: DraftVirtualKey,
  resolved: Awaited<ReturnType<typeof resolveApplicableBudgets>>,
  chRepo?: GatewayBudgetClickHouseRepository,
): Promise<Map<string, string>> {
  if (!chRepo) return new Map();
  const projects = await prisma.project.findMany({
    where: { team: { organizationId: draft.organizationId } },
    select: { id: true },
  });
  if (projects.length === 0) return new Map();
  const targets: BudgetSpendTarget[] = resolved.map((r) => ({
    budgetId: r.budget.id,
    scope: r.budget.scopeType,
    scopeId: r.bucketScopeId,
    window: r.budget.window,
    match: "exact",
    periodFloorMs: budgetPeriodFloorMs(r.budget),
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

async function loadScopeLabels(
  prisma: PrismaClient,
  resolved: Awaited<ReturnType<typeof resolveApplicableBudgets>>,
): Promise<Map<string, string>> {
  const idsByType = new Map<string, string[]>();
  for (const { budget } of resolved) {
    const list = idsByType.get(budget.scopeType) ?? [];
    list.push(budget.scopeId);
    idsByType.set(budget.scopeType, list);
  }
  const labels = new Map<string, string>();
  const put = (type: string, id: string, label: string) =>
    labels.set(`${type}:${id}`, label);

  const orgIds = idsByType.get("ORGANIZATION") ?? [];
  if (orgIds.length > 0) {
    const rows = await prisma.organization.findMany({
      where: { id: { in: orgIds } },
      select: { id: true, name: true },
    });
    for (const r of rows) put("ORGANIZATION", r.id, r.name);
  }
  const teamIds = idsByType.get("TEAM") ?? [];
  if (teamIds.length > 0) {
    const rows = await prisma.team.findMany({
      where: { id: { in: teamIds } },
      select: { id: true, name: true },
    });
    for (const r of rows) put("TEAM", r.id, r.name);
  }
  const projectIds = idsByType.get("PROJECT") ?? [];
  if (projectIds.length > 0) {
    const rows = await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, name: true },
    });
    for (const r of rows) put("PROJECT", r.id, r.name);
  }
  const groupIds = idsByType.get("GROUP") ?? [];
  if (groupIds.length > 0) {
    const rows = await prisma.group.findMany({
      where: { id: { in: groupIds } },
      select: { id: true, name: true },
    });
    for (const r of rows) put("GROUP", r.id, r.name);
  }
  const userIds = idsByType.get("PRINCIPAL") ?? [];
  if (userIds.length > 0) {
    const rows = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    for (const r of rows) {
      put("PRINCIPAL", r.id, r.name ?? r.email ?? r.id);
    }
  }
  const vkIds = idsByType.get("VIRTUAL_KEY") ?? [];
  if (vkIds.length > 0) {
    const rows = await prisma.virtualKey.findMany({
      where: { id: { in: vkIds } },
      select: { id: true, name: true },
    });
    for (const r of rows) put("VIRTUAL_KEY", r.id, r.name);
  }
  return labels;
}
