/**
 * "Already applies": budgets that will constrain a key, answered for a key that may not exist yet. Create drawer input is a draft (picked scopes + owner for a personal key); resolution is the same call the gateway bundle and request-time check make, so the list can't promise a constraint that won't be enforced or miss one that will. Spend comes from the same rollup the budgets page reads, so a limit and its "spent so far" agree everywhere.
 */
import type { ProjectService } from "@langwatch/project-contract";

import { type BudgetSpendTarget, GatewayBudgetSpendPort } from "../ports/gateway-budget-spend.port";
import {
  budgetPeriodFloorMs,
  scopeTargetKey,
  type GatewayBudgetResolutionTarget,
  type GatewayResolvedBudget,
  type GatewayService,
} from "@langwatch/gateway-contract";
import { GatewayProviderLabelRepository } from "../repositories/gateway-provider-label.repository";
import { type ScopeInput } from "../ports/gateway-virtual-key.port";

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
   * Set when this row is the budget a key's drawer field manages. Edit drawer seeds its field from this row and hides it from the inherited list; independently created key-targeted budgets show as inherited constraints like any other.
   */
  managedByVirtualKeyId: string | null;
};

/**
 * The budgets that already apply to a key, drafted or saved.
 */
export class GatewayApplicableBudgetsService {
  private constructor(
    private readonly budgetDecisions: GatewayService,
    private readonly providerLabels: GatewayProviderLabelRepository,
  ) {}

  static create(input: {
    budgetDecisions: GatewayService;
    providerLabels: GatewayProviderLabelRepository;
  }): GatewayApplicableBudgetsService {
    return new GatewayApplicableBudgetsService(input.budgetDecisions, input.providerLabels);
  }

  async resolveApplicableBudgetsForDraftKey(
    projects: ProjectService,
    draft: DraftVirtualKey,
    chRepo?: GatewayBudgetSpendPort,
  ): Promise<ApplicableBudget[]> {
    // Where this key's traces land decides whether team/project-scoped
    // budgets reach it. An existing key's stored destination is the same
    // pointer the materialiser follows — deciding it again here would empty
    // the list for a key whose destination was deleted while its team/
    // project budgets kept enforcing. A draft previews the decision the save is about to make.
    const traceProject = draft.virtualKeyId
      ? draft.traceProjectId
        ? await projects.tryGetTraceDestination(draft.traceProjectId)
        : null
      : await decidedTraceProject({ projects, draft });

    return await this.resolveApplicableBudgetsForTarget(
      {
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
      chRepo,
    );
  }

  /**
   * Same decoration for a caller that already knows the exact resolution target (team, project, key, principal) and skips the draft's trace-project inference. Read by budget-overview with the user's personal workspace as the target.
   */
  async resolveApplicableBudgetsForTarget(
    target: GatewayBudgetResolutionTarget,
    chRepo?: GatewayBudgetSpendPort,
  ): Promise<ApplicableBudget[]> {
    const resolved = await this.budgetDecisions.resolveApplicableBudgets(target);
    if (resolved.length === 0) {
      return [];
    }

    // Independent lookups on an interactive path: run them together.
    const [spentByBudgetId, targets, providerLabels] = await Promise.all([
      loadSpend(this.budgetDecisions, target.organizationId, resolved, chRepo),
      this.budgetDecisions.resolveScopeTargets(
        resolved.map((r) => r.budget),
        target.organizationId,
      ),
      this.providerLabels.resolveProviderLabels(resolved.map((r) => r.budget)),
    ]);

    // bucketScopeId stays internal: it is where spend accrues, not the
    // budget's target, and a UI showing "<group>:<user>" would read as one.
    return resolved.map(({ budget }) => ({
      id: budget.id,
      name: budget.name,
      scopeType: budget.scopeType,
      scopeId: budget.scopeId,
      scopeLabel:
        targets.get(scopeTargetKey(budget.scopeType, budget.scopeId))?.name ?? budget.scopeId,
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
}

/**
 * Where a draft's traces would land once it is saved: the same decision the
 * save will make, so the list cannot preview a destination the key will not
 * get. A draft the save would refuse has none yet.
 */
async function decidedTraceProject({
  projects,
  draft,
}: {
  projects: ProjectService;
  draft: DraftVirtualKey;
}) {
  const decision = await projects.resolveTraceDestination({
    organizationId: draft.organizationId,
    projectScopeIds: draft.scopes
      .filter((scope) => scope.scopeType === "PROJECT")
      .map((scope) => scope.scopeId),
    traceProjectId: draft.traceProjectId,
  });

  return decision.outcome === "resolved" ? decision.project : null;
}

async function loadSpend(
  budgetDecisions: GatewayService,
  organizationId: string,
  resolved: GatewayResolvedBudget[],
  chRepo?: GatewayBudgetSpendPort,
): Promise<Map<string, string>> {
  if (!chRepo) {
    return new Map();
  }

  const tenantIds = await budgetDecisions.listSpendTenantIds(organizationId);
  if (tenantIds.length === 0) {
    return new Map();
  }

  const targets: BudgetSpendTarget[] = resolved.map((r) => ({
    budgetId: r.budget.id,
    scope: r.budget.scopeType,
    scopeId: r.bucketScopeId,
    window: r.budget.window,
    match: "exact",
    periodFloorMs: budgetPeriodFloorMs(r.budget),
  }));
  try {
    const spends = await chRepo.getSpendForTargetsAcrossTenants(tenantIds, targets);

    return new Map(spends.map((s) => [s.budgetId, s.spentUsd]));
  } catch {
    // Spend is decoration on this list; the budgets themselves are the
    // answer. A rollup outage must not blank the drawer.
    return new Map();
  }
}
