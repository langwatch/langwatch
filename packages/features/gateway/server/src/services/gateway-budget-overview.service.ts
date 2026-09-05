/**
 * The one budget-overview read, shared by /me, the CLI login epilogue and the REST mirror: before it existed each surface collapsed the applicable set to a single number and lost scope, so a whole-org cap read as personal. Keeps every budget binding the user's own keys with its scope named. Resolution reuses the enforcement stack (resolveApplicableBudgets via resolveApplicableBudgetsForTarget) targeted at the user's own workspace/key/principal, so what's listed is exactly what will block them. A member reads their OWN overview via the personal-team ADMIN binding they already hold, not org-level virtualKeys:manage; the service re-checks org membership itself, fail closed. Spec: specs/ai-gateway/budget-overview.feature
 */

import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { GatewayBudget, GatewayBudgetScopeType } from "@langwatch/gateway-contract";

import {
  type ApplicableBudget,
  GatewayApplicableBudgetsService,
} from "./gateway-applicable-budgets.service";
import { GatewayBudgetSpendPort } from "../ports/gateway-budget-spend.port";
import { scopeTargetKey, type GatewayService, GatewayWindow } from "@langwatch/gateway-contract";
import { GatewayProviderLabelRepository } from "../repositories/gateway-provider-label.repository";
import type { GatewayBudgetOverviewRepository } from "../repositories/gateway-budget-overview.repository";

/**
 * How binding a scope is to the reader, most binding first (personal > key > shared pools) — the truncation order for surfaces with only a few lines. `satisfies` over the Prisma enum keeps the map exhaustive: a new scope kind fails to compile rather than silently sorting last.
 */
export const BUDGET_SCOPE_RANK = {
  PRINCIPAL: 0,
  VIRTUAL_KEY: 1,
  GROUP: 2,
  ATTRIBUTED_USER: 3,
  PROJECT: 4,
  TEAM: 5,
  ORGANIZATION: 6,
} as const satisfies Record<GatewayBudgetScopeType, number>;

/**
 * What the budget is, relative to the person reading it. `"other"` is the
 * honest answer for a scope kind this module has no wording for: surfaces
 * then name the target instead of claiming a scope.
 */
export type BudgetOverviewScopeClass =
  | "organization"
  | "team"
  | "project"
  | "personal"
  | "key"
  | "department"
  | "other";

export type BudgetOverviewItem = ApplicableBudget & {
  scopeClass: BudgetOverviewScopeClass;
  /**
   * The parenthetical every surface renders after the numbers:
   * "whole organization budget", "team budget (Core)", "personal budget",
   * "department budget (Engineering)", "this key's budget".
   */
  scopePhrase: string;
  /**
   * When the current window's spend resets to zero, in UTC. Matches the rollup's own toStartOfDay/Week/Month bucketing on UTC OccurredAt — budget.timezone has no reader on the reset path (budgetWindow.ts) — regardless of the column. Null for TOTAL windows, which never reset.
   */
  resetsAt: string | null;
  /**
   * Top models by spend in the personal workspace this month. Attached only to personal-class items, and only when the caller asked (includeTopModels), so lightweight surfaces skip the extra ClickHouse read.
   */
  topModels?: Array<{ model: string; spentUsd: number }>;
};

export type BudgetOverviewForUser = {
  /**
   * False when this org gives the user no member-facing gateway path at
   * all: the governance flag is off, or they are not a member. Consumers
   * must then render nothing budget-related, not an empty state.
   */
  gatewayAccess: boolean;
  reason?: "flag_off" | "no_membership";
  budgets: BudgetOverviewItem[];
};

type PersonalVirtualKeyReader = {
  listActiveForPrincipal(input: {
    userId: string;
    organizationId: string;
  }): Promise<Array<{ id: string }>>;
};

/**
 * The two shapes the Enterprise personal-usage reader speaks, restated here rather than imported — governance is Enterprise-only and a core package may not depend on it. Structural, so the Enterprise reader satisfies this without either side naming the other.
 */
type PersonalUsageQuery = {
  personalProjectId: string;
  window?: { startMs: number; endMs: number } | undefined;
  userId?: string | undefined;
  ingestionTenantId?: string | undefined;
};

type PersonalUsageRow = {
  label: string;
  spentUsd: number;
  billedUsd: number;
  requests: number;
};

type PersonalUsageReader = {
  breakdownByModel(input: PersonalUsageQuery, limit?: number): Promise<PersonalUsageRow[]>;
};

export class BudgetOverviewService {
  private constructor(
    private readonly repository: GatewayBudgetOverviewRepository,
    private readonly organizations: OrganizationService,
    private readonly featureFlags: FeatureFlagService,
    private readonly personalVirtualKeys: PersonalVirtualKeyReader,
    private readonly personalUsage: PersonalUsageReader | undefined,
    private readonly budgetDecisions: GatewayService,
    private readonly providerLabels: GatewayProviderLabelRepository,
    private readonly chRepo?: GatewayBudgetSpendPort,
  ) {}

  private get applicableBudgets(): GatewayApplicableBudgetsService {
    return GatewayApplicableBudgetsService.create({
      budgetDecisions: this.budgetDecisions,
      providerLabels: this.providerLabels,
    });
  }

  static create(options: {
    repository: GatewayBudgetOverviewRepository;
    organizations: OrganizationService;
    featureFlags: FeatureFlagService;
    personalVirtualKeys: PersonalVirtualKeyReader;
    budgetDecisions: GatewayService;
    providerLabels: GatewayProviderLabelRepository;
    personalUsage?: PersonalUsageReader;
    budgetRepository?: GatewayBudgetSpendPort;
  }): BudgetOverviewService {
    return new BudgetOverviewService(
      options.repository,
      options.organizations,
      options.featureFlags,
      options.personalVirtualKeys,
      options.personalUsage,
      options.budgetDecisions,
      options.providerLabels,
      options.budgetRepository,
    );
  }

  /**
   * Every budget binding this user's own keys in this org, most binding first, spend from the same rollup enforcement reads. Empty-safe: a user with no personal workspace still sees the org/principal/department budgets that will bind them.
   */
  async overviewForUser(input: {
    organizationId: string;
    userId: string;
    includeTopModels?: boolean;
  }): Promise<BudgetOverviewForUser> {
    const membership = await this.organizations.isMember({
      organizationId: input.organizationId,
      userId: input.userId,
    });
    if (!membership) {
      return { gatewayAccess: false, reason: "no_membership", budgets: [] };
    }

    // Same gate + same default as the device-flow approve path: the flag
    // ships on and only an explicit off turns the member surfaces dark.
    const governanceEnabled = await this.featureFlags
      .isEnabled("release_ui_ai_governance_enabled", {
        kind: "organization",
        userId: input.userId,
        organizationId: input.organizationId,
      })
      .catch(() => true);
    if (!governanceEnabled) {
      return { gatewayAccess: false, reason: "flag_off", budgets: [] };
    }

    // Independent lookups on the /me blocking path: run them together.
    // The gates above stay sequential so the service still fails closed
    // before it reads any data.
    const [workspace, personalVks] = await Promise.all([
      this.organizations.tryFindPersonalWorkspace({
        userId: input.userId,
        organizationId: input.organizationId,
      }),
      this.personalVirtualKeys.listActiveForPrincipal({
        userId: input.userId,
        organizationId: input.organizationId,
      }),
    ]);
    const personalVkIds = new Set(personalVks.map((vk) => vk.id));

    // The model breakdown needs only the workspace, so it does not queue
    // behind budget resolution.
    const [applicable, topModels] = await Promise.all([
      this.applicableBudgets.resolveApplicableBudgetsForTarget(
        {
          organizationId: input.organizationId,
          teamId: workspace?.team.id ?? null,
          projectId: workspace?.project.id ?? null,
          virtualKeyId: personalVks[0]?.id ?? null,
          principalUserId: input.userId,
        },
        this.chRepo,
      ),
      input.includeTopModels
        ? this.loadTopModels({
            personalProjectId: workspace?.project.id ?? null,
            userId: input.userId,
          })
        : Promise.resolve(undefined),
    ]);

    const items = applicable
      .map((budget) => {
        const scopeClass = scopeClassForUser(budget, {
          personalTeamId: workspace?.team.id ?? null,
          personalProjectId: workspace?.project.id ?? null,
          personalVkIds,
          userId: input.userId,
        });

        return {
          ...budget,
          scopeClass,
          scopePhrase: scopePhraseFor(scopeClass, budget.scopeLabel),
          resetsAt: resetsAtFor(budget.window),
          ...(topModels && topModels.length > 0 && scopeClass === "personal" ? { topModels } : {}),
        };
      })
      .sort(byMostBindingFirst);

    return { gatewayAccess: true, budgets: items };
  }

  /**
   * One budget in the same item shape, for surfaces looking at the budget itself (settings detail page) rather than a person. No user in context, so a GROUP budget reports the whole group's spend and person-relative labels fall back to absolute phrases.
   */
  async tryOverviewForBudget(input: {
    organizationId: string;
    budgetId: string;
  }): Promise<BudgetOverviewItem | null> {
    const budget = await this.repository.tryFindBudget({
      organizationId: input.organizationId,
      budgetId: input.budgetId,
    });
    if (!budget) {
      return null;
    }

    const [targets, providerLabels, spentUsd] = await Promise.all([
      this.budgetDecisions.resolveScopeTargets([budget], input.organizationId),
      this.providerLabels.resolveProviderLabels([budget]),
      this.loadSpendForBudget(budget, input.organizationId),
    ]);

    const scopeLabel =
      targets.get(scopeTargetKey(budget.scopeType, budget.scopeId))?.name ?? budget.scopeId;
    const scopeClass = absoluteScopeClass(budget.scopeType) ?? "other";

    return {
      id: budget.id,
      name: budget.name,
      scopeType: budget.scopeType,
      scopeId: budget.scopeId,
      scopeLabel,
      window: budget.window,
      limitUsd: budget.limitUsd.toFixed(6),
      spentUsd,
      onBreach: budget.onBreach,
      timezone: budget.timezone,
      providerKey: budget.providerKey,
      providerLabel: budget.providerKey
        ? (providerLabels.get(budget.providerKey) ?? budget.providerKey)
        : null,
      isPerMember: budget.scopeType === "GROUP",
      managedByVirtualKeyId: budget.managedByVirtualKeyId,
      scopeClass,
      scopePhrase: absoluteScopePhrase(budget.scopeType, scopeLabel),
      resetsAt: resetsAtFor(budget.window),
    };
  }

  private async loadSpendForBudget(budget: GatewayBudget, organizationId: string): Promise<string> {
    if (!this.chRepo) {
      return "0";
    }

    const tenantIds = await this.budgetDecisions.listSpendTenantIds(organizationId);
    if (tenantIds.length === 0) {
      return "0";
    }

    const now = new Date();
    try {
      const spends = await this.chRepo.getSpendForTargetsAcrossTenants(
        tenantIds,
        GatewayBudgetSpendPort.targetsForBudgets({ budgets: [budget], now }),
        now,
      );

      return spends[0]?.spentUsd ?? "0";
    } catch {
      // Same posture as the applicable-budgets list: spend decorates the
      // budget, a rollup outage must not blank the surface.
      return "0";
    }
  }

  private async loadTopModels(input: {
    personalProjectId: string | null;
    userId: string;
  }): Promise<Array<{ model: string; spentUsd: number }>> {
    if (!input.personalProjectId || !this.personalUsage) {
      return [];
    }

    try {
      const breakdown = await this.personalUsage.breakdownByModel(
        { personalProjectId: input.personalProjectId, userId: input.userId },
        3,
      );

      return breakdown.map((b) => ({ model: b.label, spentUsd: b.spentUsd }));
    } catch {
      return [];
    }
  }
}

/** Last, for a scope kind the rank map has no opinion about. */
const UNRANKED_SCOPE = 99;

function scopeRank(scopeType: string): number {
  return BUDGET_SCOPE_RANK[scopeType as keyof typeof BUDGET_SCOPE_RANK] ?? UNRANKED_SCOPE;
}

function byMostBindingFirst(a: BudgetOverviewItem, b: BudgetOverviewItem): number {
  const rank = scopeRank(a.scopeType) - scopeRank(b.scopeType);
  if (rank !== 0) {
    return rank;
  }

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function scopeClassForUser(
  budget: ApplicableBudget,
  ctx: {
    personalTeamId: string | null;
    personalProjectId: string | null;
    personalVkIds: Set<string>;
    userId: string;
  },
): BudgetOverviewScopeClass {
  switch (budget.scopeType) {
    case "ORGANIZATION":
      return "organization";
    case "PRINCIPAL":
      // Resolution targets this caller's own principal, so a PRINCIPAL
      // budget in the set is always a cap on them.
      return "personal";
    case "GROUP":
      return "department";
    case "VIRTUAL_KEY":
      return "key";
    case "TEAM":
      // The personal team is workspace plumbing, not a team the user
      // thinks of; a budget on it is a personal cap.
      return budget.scopeId === ctx.personalTeamId ? "personal" : "team";
    case "PROJECT":
      return budget.scopeId === ctx.personalProjectId ? "personal" : "project";
    default:
      return absoluteScopeClass(budget.scopeType) ?? "other";
  }
}

const SCOPE_CLASS_BY_TYPE = {
  ORGANIZATION: "organization",
  TEAM: "team",
  PROJECT: "project",
  VIRTUAL_KEY: "key",
  PRINCIPAL: "personal",
  GROUP: "department",
  // Per-end-user attributed budgets do not bind a member's own keys, so
  // they never surface in a member overview; name the target rather than
  // assert a member-relative scope for the exhaustive-map fallback.
  ATTRIBUTED_USER: "other",
} as const satisfies Record<GatewayBudgetScopeType, BudgetOverviewScopeClass>;

/**
 * Null for a scope kind this module doesn't know — callers must then name the target rather than assert a scope, since mislabelling an unrecognised scope "whole organization budget" is the same mislabel this service exists to remove.
 */
function absoluteScopeClass(scopeType: string): BudgetOverviewScopeClass | null {
  return SCOPE_CLASS_BY_TYPE[scopeType as keyof typeof SCOPE_CLASS_BY_TYPE] ?? null;
}

/**
 * The user-facing parenthetical for a budget's scope. Kept here so the
 * /me page, the CLI epilogue, and the settings surfaces can never label
 * the same budget differently.
 */
function scopePhraseFor(scopeClass: BudgetOverviewScopeClass, scopeLabel: string): string {
  switch (scopeClass) {
    case "organization":
      return "whole organization budget";
    case "team":
      return `team budget (${scopeLabel})`;
    case "project":
      return `project budget (${scopeLabel})`;
    case "personal":
      return "personal budget";
    case "key":
      return "this key's budget";
    case "department":
      return `department budget (${scopeLabel})`;
    case "other":
      return `budget (${scopeLabel})`;
  }
}

function absoluteScopePhrase(scopeType: string, scopeLabel: string): string {
  const scopeClass = absoluteScopeClass(scopeType);
  // Without a user in context "this key's budget" and a bare "personal
  // budget" would dangle; name the target instead.
  if (scopeClass === "key") {
    return `key budget (${scopeLabel})`;
  }

  if (scopeClass === "personal") {
    return `personal budget (${scopeLabel})`;
  }

  return scopePhraseFor(scopeClass ?? "other", scopeLabel);
}

function resetsAtFor(window: string): string | null {
  if (window === "TOTAL") {
    return null;
  }

  return GatewayWindow.nextResetAt(
    window as Parameters<typeof GatewayWindow.nextResetAt>[0],
  ).toISOString();
}
