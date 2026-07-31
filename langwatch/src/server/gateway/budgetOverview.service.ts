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

import { PersonalUsageService } from "@ee/governance/services/personalUsage.service";
import { PersonalVirtualKeyService } from "@ee/governance/services/personalVirtualKey.service";
import { PersonalWorkspaceService } from "@ee/governance/services/personalWorkspace.service";
import type { GatewayBudget, PrismaClient } from "@prisma/client";
import { featureFlagService } from "~/server/featureFlag/featureFlag.service";

import {
  type ApplicableBudget,
  resolveApplicableBudgetsForTarget,
} from "./applicableBudgets.service";
import type { GatewayBudgetClickHouseRepository } from "./budget.clickhouse.repository";
import { spendTargetsForBudgets } from "./budget.clickhouse.repository";
import { nextResetAt } from "./budgetWindow";
import { resolveProviderLabels } from "./providerLabels";
import { resolveScopeTargetsBatch, scopeTargetKey } from "./scopeTargets";

/**
 * How binding a budget scope is to the person reading, most binding
 * first. Personal caps beat key caps beat the shared pools; every
 * surface that can only show a few lines truncates in this order.
 */
export const BUDGET_SCOPE_RANK: Record<string, number> = {
  PRINCIPAL: 0,
  VIRTUAL_KEY: 1,
  GROUP: 2,
  PROJECT: 3,
  TEAM: 4,
  ORGANIZATION: 5,
};

/** What the budget is, relative to the person reading it. */
export type BudgetOverviewScopeClass =
  | "organization"
  | "team"
  | "project"
  | "personal"
  | "key"
  | "department";

export type BudgetOverviewItem = ApplicableBudget & {
  scopeClass: BudgetOverviewScopeClass;
  /**
   * The parenthetical every surface renders after the numbers:
   * "whole organization budget", "team budget (Core)", "personal budget",
   * "department budget (Engineering)", "this key's budget".
   */
  scopePhrase: string;
  /**
   * When the current window's spend goes back to zero. Computed from the
   * window the same way enforcement's rollup buckets periods (UTC), so
   * the promise matches when the ledger actually resets. Null for TOTAL
   * windows, which never reset.
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

export class BudgetOverviewService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly chRepo?: GatewayBudgetClickHouseRepository,
  ) {}

  static create(
    prisma: PrismaClient,
    chRepo?: GatewayBudgetClickHouseRepository,
  ): BudgetOverviewService {
    return new BudgetOverviewService(prisma, chRepo);
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
    const membership = await this.prisma.organizationUser.findFirst({
      where: { organizationId: input.organizationId, userId: input.userId },
      select: { userId: true },
    });
    if (!membership) {
      return { gatewayAccess: false, reason: "no_membership", budgets: [] };
    }

    // Same gate + same default as the device-flow approve path: the flag
    // ships on and only an explicit off turns the member surfaces dark.
    const governanceEnabled = await featureFlagService
      .isEnabled("release_ui_ai_governance_enabled", {
        distinctId: input.userId,
        organizationId: input.organizationId,
        defaultValue: true,
      })
      .catch(() => true);
    if (!governanceEnabled) {
      return { gatewayAccess: false, reason: "flag_off", budgets: [] };
    }

    const workspace = await new PersonalWorkspaceService(
      this.prisma,
    ).findExisting({
      userId: input.userId,
      organizationId: input.organizationId,
    });
    const personalVks = await PersonalVirtualKeyService.create(
      this.prisma,
    ).list({
      userId: input.userId,
      organizationId: input.organizationId,
    });
    const personalVkIds = new Set(personalVks.map((vk) => vk.id));

    const applicable = await resolveApplicableBudgetsForTarget(
      this.prisma,
      {
        organizationId: input.organizationId,
        teamId: workspace?.team.id ?? null,
        projectId: workspace?.project.id ?? null,
        virtualKeyId: personalVks[0]?.id ?? null,
        principalUserId: input.userId,
      },
      this.chRepo,
    );

    const topModels = input.includeTopModels
      ? await this.loadTopModels({
          personalProjectId: workspace?.project.id ?? null,
          userId: input.userId,
        })
      : undefined;

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
          ...(topModels && topModels.length > 0 && scopeClass === "personal"
            ? { topModels }
            : {}),
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
      resolveScopeTargetsBatch(this.prisma, [budget], input.organizationId),
      resolveProviderLabels({ prisma: this.prisma, budgets: [budget] }),
      this.loadSpendForBudget(budget, input.organizationId),
    ]);

    const scopeLabel =
      targets.get(scopeTargetKey(budget.scopeType, budget.scopeId))?.name ??
      budget.scopeId;
    const scopeClass = absoluteScopeClass(budget.scopeType);
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

  private async loadSpendForBudget(
    budget: GatewayBudget,
    organizationId: string,
  ): Promise<string> {
    if (!this.chRepo) return "0";
    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });
    if (projects.length === 0) return "0";
    try {
      const spends = await this.chRepo.getSpendForTargetsAcrossTenants(
        projects.map((p) => p.id),
        spendTargetsForBudgets([budget]),
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
    if (!input.personalProjectId) return [];
    try {
      const breakdown = await new PersonalUsageService().breakdownByModel(
        { personalProjectId: input.personalProjectId, userId: input.userId },
        3,
      );
      return breakdown.map((b) => ({ model: b.label, spentUsd: b.spentUsd }));
    } catch {
      return [];
    }
  }
}

function byMostBindingFirst(
  a: BudgetOverviewItem,
  b: BudgetOverviewItem,
): number {
  const rank =
    (BUDGET_SCOPE_RANK[a.scopeType] ?? 99) -
    (BUDGET_SCOPE_RANK[b.scopeType] ?? 99);
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
      return budget.scopeId === ctx.userId
        ? "personal"
        : absoluteScopeClass(budget.scopeType);
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
      return absoluteScopeClass(budget.scopeType);
  }
}

function absoluteScopeClass(scopeType: string): BudgetOverviewScopeClass {
  switch (scopeType) {
    case "ORGANIZATION":
      return "organization";
    case "TEAM":
      return "team";
    case "PROJECT":
      return "project";
    case "VIRTUAL_KEY":
      return "key";
    case "PRINCIPAL":
      return "personal";
    case "GROUP":
      return "department";
    default:
      return "organization";
  }
}

/**
 * The user-facing parenthetical for a budget's scope. Kept here so the
 * /me page, the CLI epilogue, and the settings surfaces can never label
 * the same budget differently.
 */
export function scopePhraseFor(
  scopeClass: BudgetOverviewScopeClass,
  scopeLabel: string,
): string {
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
  }
}

function absoluteScopePhrase(scopeType: string, scopeLabel: string): string {
  const scopeClass = absoluteScopeClass(scopeType);
  // Without a user in context "this key's budget" and a bare "personal
  // budget" would dangle; name the target instead.
  if (scopeClass === "key") return `key budget (${scopeLabel})`;
  if (scopeClass === "personal") return `personal budget (${scopeLabel})`;
  return scopePhraseFor(scopeClass, scopeLabel);
}

function resetsAtFor(window: string): string | null {
  if (window === "TOTAL") return null;
  return nextResetAt(window as Parameters<typeof nextResetAt>[0]).toISOString();
}
