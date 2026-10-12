import { type AuthzApi, AuthzScopeNotFoundError } from "@langwatch/authz-contract";
import {
  CONTRACT_BUDGET_EXTERNAL_ID,
  type HostedCaller,
} from "@langwatch/enterprise-connect-contract";
import type { GatewayApi, GatewayBudgetWithSeats } from "@langwatch/gateway-contract";
import type { Instant } from "@langwatch/time";

type UsageGateway = Pick<
  GatewayApi,
  "findVirtualKeyById" | "resolveApplicableBudgets" | "listBudgetsWithHealth"
>;

/**
 * The budgets that apply to the calling key, with live spend when readable, as main's
 * `PrismaHostedUsageReader` read them: the project's team from authz's scope, the key's principal
 * and the budgets themselves from the gateway.
 */
export class HostedUsageReaderService implements HostedUsageReader {
  static create({
    gateway,
    scopes,
  }: {
    gateway: UsageGateway;
    scopes: Pick<AuthzApi, "getScope">;
  }): HostedUsageReaderService {
    return new HostedUsageReaderService(gateway, scopes);
  }

  private constructor(
    private readonly gateway: UsageGateway,
    private readonly scopes: Pick<AuthzApi, "getScope">,
  ) {}

  async read(caller: HostedCaller): ReturnType<HostedUsageReader["read"]> {
    const [teamId, key] = await Promise.all([
      caller.projectId ? this.#teamOf(caller.projectId) : null,
      this.gateway.findVirtualKeyById(caller.virtualKeyId, caller.organizationId),
    ]);
    const applicable = await this.gateway.resolveApplicableBudgets({
      organizationId: caller.organizationId,
      virtualKeyId: caller.virtualKeyId,
      teamId,
      projectId: caller.projectId,
      principalUserId: key?.principalUserId ?? null,
    });
    const applicableIds = new Set(applicable.map(({ budget }) => budget.id));
    const { budgets, spendAvailable, readAt } = await this.gateway.listBudgetsWithHealth(
      caller.organizationId,
    );

    return {
      spendAvailable,
      readAt,
      budgets: budgets
        .filter((budget) => applicableIds.has(budget.id))
        .map((budget) => usageOf({ budget, spendAvailable })),
    };
  }

  /** A project authz does not know resolves no team, as a missing project did. */
  async #teamOf(projectId: string): Promise<string | null> {
    try {
      const scope = await this.scopes.getScope({ projectId });
      return scope.type === "project" ? scope.teamId : null;
    } catch (error) {
      if (error instanceof AuthzScopeNotFoundError) return null;
      throw error;
    }
  }
}

function usageOf({
  budget,
  spendAvailable,
}: {
  budget: GatewayBudgetWithSeats;
  spendAvailable: boolean;
}): HostedBudgetUsage {
  return {
    id: budget.id,
    scope: budget.scopeType.toLowerCase(),
    window: budget.window.toLowerCase(),
    limitUsd: Number(budget.limitUsd.toString()),
    spentUsd: spendAvailable ? Number(budget.spentUsd.toString()) : null,
    onBreach: budget.onBreach === "BLOCK" ? "block" : "warn",
    periodStartedAt: budget.currentPeriodStartedAt,
    isContract: budget.externalId === CONTRACT_BUDGET_EXTERNAL_ID,
  };
}

/** One budget that applies to the caller, with its spend when that is known. */
export interface HostedBudgetUsage {
  id: string;
  scope: string;
  window: string;
  limitUsd: number;
  /** Null when live spend could not be read. Never zero in that case. */
  spentUsd: number | null;
  onBreach: "block" | "warn";
  periodStartedAt: Instant;
  isContract: boolean;
}

/** The budgets that apply to the calling key, with live spend when readable. */
export interface HostedUsageReader {
  read(caller: HostedCaller): Promise<{
    budgets: HostedBudgetUsage[];
    spendAvailable: boolean;
    readAt: Instant;
  }>;
}
