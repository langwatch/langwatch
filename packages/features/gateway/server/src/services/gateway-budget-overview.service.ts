/**
 * The one budget-overview read: which budgets bind a person's gateway
 * usage, with labels precise enough to say so out loud.
 *
 * Every member-facing surface that says "budget" reads this service: the
 * /me page, the CLI login epilogue, and the REST mirror behind it. Before
 * it existed each surface collapsed the applicable set to a single number
 * and lost the scope, so a whole-organization cap rendered as "Month
 * budget: $100" and read as personal. The item here keeps every budget
 * that binds the user's own keys and names each one's scope
 * ("whole organization budget", "team budget (Core)", "personal budget"),
 * so no consumer has to guess what a number governs.
 *
 * Resolution reuses the same stack the gateway enforces with
 * (`resolveApplicableBudgets` via `resolveApplicableBudgetsForTarget`),
 * targeted at the user's personal workspace + personal key + own
 * principal. What this lists is exactly what will block them.
 *
 * Authorization tier: a member reads their OWN overview. That is the
 * same self-scope their personal-team ADMIN role binding already grants
 * over the personal project, so no org-level virtualKeys:manage is
 * required; callers gate on org membership (organization:view) and the
 * service re-checks membership itself, fail closed.
 *
 * Spec: specs/ai-gateway/budget-overview.feature
 */

import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type {
  GatewayBudget,
  GatewayBudgetScopeType,
  PrismaClient,
} from "@langwatch/prisma-client/generated";

import {
  type ApplicableBudget,
  resolveApplicableBudgetsForTarget,
} from "./gateway-applicable-budgets.service";
import { GatewayBudgetSpendPort } from "../ports/gateway-budget-spend.port";
import { scopeTargetKey, type GatewayService } from "@langwatch/gateway-contract";
import { spendTargetsForBudgets } from "../adapters/gateway-budget-spend-target.adapter";
import { GatewayWindow } from "../adapters/gateway-window.adapter";
import { resolveProviderLabels } from "../repositories/prisma/prisma.gateway-provider-label.repository";

/**
 * How binding a budget scope is to the person reading, most binding
 * first. Personal caps beat key caps beat the shared pools; every
 * surface that can only show a few lines truncates in this order.
 *
 * `satisfies` over the Prisma enum keeps the map exhaustive: a new scope
 * kind fails to compile here rather than silently sorting last.
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
   * When the current window's spend goes back to zero, in UTC. Every
   * budget resets on that clock: the rollup buckets periods with
   * `toStartOfDay`/`Week`/`Month` on UTC `OccurredAt`, and `budget.timezone`
   * has no reader on the reset path (see `budgetWindow.ts`), so this
   * matches when the ledger actually rolls over regardless of the column.
   * Null for TOTAL windows, which never reset.
   */
  resetsAt: string | null;
  /**
   * Top models by spend in the user's personal workspace this month.
   * Only attached to personal-class items, and only when the caller
   * asked (`includeTopModels`), so lightweight surfaces skip the extra
   * ClickHouse read.
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
 * The two shapes the Enterprise personal-usage reader speaks, restated here
 * rather than imported: governance is an Enterprise feature and a core package
 * may not depend on one. Structural, so the Enterprise reader satisfies this
 * without either side naming the other.
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
    private readonly prisma: PrismaClient,
    private readonly organizations: OrganizationService,
    private readonly featureFlags: FeatureFlagService,
    private readonly personalVirtualKeys: PersonalVirtualKeyReader,
    private readonly personalUsage: PersonalUsageReader | undefined,
    private readonly budgetDecisions: GatewayService,
    private readonly chRepo?: GatewayBudgetSpendPort,
  ) {}

  static create(options: {
    database: PrismaClient;
    organizations: OrganizationService;
    featureFlags: FeatureFlagService;
    personalVirtualKeys: PersonalVirtualKeyReader;
    budgetDecisions: GatewayService;
    personalUsage?: PersonalUsageReader;
    budgetRepository?: GatewayBudgetSpendPort;
  }): BudgetOverviewService {
    return new BudgetOverviewService(
      options.database,
      options.organizations,
      options.featureFlags,
      options.personalVirtualKeys,
      options.personalUsage,
      options.budgetDecisions,
      options.budgetRepository,
    );
  }

  /**
   * Every budget that binds this user's own keys in this organization,
   * most binding first, with spend from the same rollup enforcement
   * reads. Empty-safe: a user with no personal workspace yet still sees
   * the org, principal, and department budgets that will bind them.
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
      resolveApplicableBudgetsForTarget(
        this.prisma,
        this.budgetDecisions,
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
   * One budget in the same item shape, for surfaces looking at the
   * budget itself rather than at a person (the settings detail page).
   * No user in context, so a GROUP budget reports the whole group's
   * spend and person-relative classes ("personal", "this key's budget")
   * fall back to their absolute phrases.
   */
  async overviewForBudget(input: {
    organizationId: string;
    budgetId: string;
  }): Promise<BudgetOverviewItem | null> {
    const budget = await this.prisma.gatewayBudget.findFirst({
      where: { id: input.budgetId, organizationId: input.organizationId },
    });
    if (!budget) return null;

    const [targets, providerLabels, spentUsd] = await Promise.all([
      this.budgetDecisions.resolveScopeTargets([budget], input.organizationId),
      resolveProviderLabels({ prisma: this.prisma, budgets: [budget] }),
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
    if (!this.chRepo) return "0";
    const tenantIds = await this.budgetDecisions.listSpendTenantIds(organizationId);
    if (tenantIds.length === 0) return "0";
    const now = new Date();
    try {
      const spends = await this.chRepo.getSpendForTargetsAcrossTenants(
        tenantIds,
        spendTargetsForBudgets({ budgets: [budget], now }),
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
    if (!input.personalProjectId || !this.personalUsage) return [];
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
  if (rank !== 0) return rank;
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
 * Null for a scope kind this module does not know. Callers must then name
 * the target rather than assert a scope: labelling an unrecognised scope
 * "whole organization budget" is the same mislabel, in the other
 * direction, that this service exists to remove.
 */
function absoluteScopeClass(scopeType: string): BudgetOverviewScopeClass | null {
  return SCOPE_CLASS_BY_TYPE[scopeType as keyof typeof SCOPE_CLASS_BY_TYPE] ?? null;
}

/**
 * The user-facing parenthetical for a budget's scope. Kept here so the
 * /me page, the CLI epilogue, and the settings surfaces can never label
 * the same budget differently.
 */
export function scopePhraseFor(scopeClass: BudgetOverviewScopeClass, scopeLabel: string): string {
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
  if (scopeClass === "key") return `key budget (${scopeLabel})`;
  if (scopeClass === "personal") return `personal budget (${scopeLabel})`;
  return scopePhraseFor(scopeClass ?? "other", scopeLabel);
}

function resetsAtFor(window: string): string | null {
  if (window === "TOTAL") return null;
  return GatewayWindow.nextResetAt(
    window as Parameters<typeof GatewayWindow.nextResetAt>[0],
  ).toISOString();
}
