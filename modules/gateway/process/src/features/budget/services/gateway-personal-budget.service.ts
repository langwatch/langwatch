/**
 * The /me budget banner: the gateway's own check at a projected cost of zero, the same
 * code path a request runs, so the banner and the command line's pre-check never disagree.
 */
import type {
  GatewayBudgetCheckInput,
  GatewayBudgetCheckResult,
  GatewayPersonalBudget,
} from "@langwatch/gateway-contract";
import {
  type OrganizationApi,
  type PersonalWorkspace,
  TeamNotFoundError,
} from "@langwatch/organization-contract";

type GatewayPersonalBudgetOptions = Readonly<{
  /** The caller's live personal keys in one organization, newest first. */
  personalKeys: Readonly<{
    findLiveWithPrincipal(input: {
      organizationId?: string;
      principalUserId?: string;
    }): Promise<readonly { id: string }[]>;
  }>;
  budgetDecisions: Readonly<{
    checkBudget(input: GatewayBudgetCheckInput): Promise<GatewayBudgetCheckResult>;
  }>;
  organizations: Pick<OrganizationApi, "getPersonalWorkspace" | "findSupportContact">;
  /** The deployment's public base URL; the request-increase link is absent without one. */
  publicBaseUrl: string | undefined;
}>;

export class GatewayPersonalBudgetService {
  static create(options: GatewayPersonalBudgetOptions): GatewayPersonalBudgetService {
    return new GatewayPersonalBudgetService(options);
  }

  private constructor(private readonly options: GatewayPersonalBudgetOptions) {}

  async getPersonalBudget({
    userId,
    organizationId,
  }: {
    userId: string;
    organizationId: string;
  }): Promise<GatewayPersonalBudget> {
    const workspace = await this.#findPersonalWorkspace({ userId, organizationId });

    if (!workspace) return { status: "ok" };

    const keys = await this.options.personalKeys.findLiveWithPrincipal({
      organizationId,
      principalUserId: userId,
    });
    // OTLP-only people intentionally hold no personal gateway key. A sentinel
    // that matches no key-scoped budget keeps them on the principal scope,
    // which is what `principalUserId` resolves regardless.
    const virtualKeyId = keys[0]?.id ?? `_ingestion_:user:${userId}`;
    const decision = await this.options.budgetDecisions.checkBudget({
      organizationId,
      teamId: workspace.team.id,
      projectId: workspace.project.id,
      virtualKeyId,
      principalUserId: userId,
      projectedCostUsd: 0,
    });
    const topScope = findTopBudgetScope(decision);

    if (!topScope) return { status: "ok" };

    return {
      status: budgetStatusOf({ decision: decision.decision, pctUsed: topScope.pctUsed }),
      scope: normalizeScope(topScope.scope),
      spentUsd: topScope.spentUsd,
      limitUsd: topScope.limitUsd,
      period: topScope.window.toLowerCase(),
      ...this.#requestIncreaseUrl(topScope),
      adminEmail: await this.options.organizations.findSupportContact({ organizationId }),
    };
  }

  #findPersonalWorkspace(input: {
    userId: string;
    organizationId: string;
  }): Promise<PersonalWorkspace | null> {
    return this.options.organizations.getPersonalWorkspace(input).catch((error: unknown) => {
      if (TeamNotFoundError.is(error)) return null;
      throw error;
    });
  }

  #requestIncreaseUrl(scope: {
    scope: string;
    scopeId: string;
    limitUsd: string;
    spentUsd: string;
  }): { requestIncreaseUrl?: string } {
    const baseUrl = this.options.publicBaseUrl;

    if (!baseUrl) return {};

    const params = new URLSearchParams({
      scope: normalizeScope(scope.scope),
      scope_id: scope.scopeId,
      limit_usd: scope.limitUsd,
      spent_usd: scope.spentUsd,
    });

    return {
      requestIncreaseUrl: `${baseUrl.replace(/\/$/, "")}/me/budget/request?${params.toString()}`,
    };
  }
}

/** One budget the gateway weighed, as the banner and the chip read it. */
type BudgetScope =
  | GatewayBudgetCheckResult["scopes"][number]
  | GatewayBudgetCheckResult["blockedBy"][number];

/** One weighed budget, with the percentage the chip renders. */
type WeighedBudgetScope = BudgetScope & { pctUsed: number };

/**
 * The budget the banner and the chip speak about: the blocking one where the gateway
 * named one, else the fullest. `blockedBy` carries the same scopes without the derived
 * percentage, so it's weighed the same way rather than tested for the field.
 */
function findTopBudgetScope(decision: GatewayBudgetCheckResult): WeighedBudgetScope | undefined {
  const blocking = decision.blockedBy[0];

  if (blocking) return weigh(blocking);

  return decision.scopes.map(weigh).toSorted((a, b) => b.pctUsed - a.pctUsed)[0];
}

function weigh(scope: BudgetScope): WeighedBudgetScope {
  return { ...scope, pctUsed: percentUsed(scope.spentUsd, scope.limitUsd) };
}

/**
 * `hard_block` reddens the banner and `soft_warn` yellows it; `allow` still
 * carries the snapshot the chip renders, which is why "ok" is an answer with
 * numbers rather than an early return without them.
 */
function budgetStatusOf({
  decision,
  pctUsed,
}: {
  decision: string;
  pctUsed: number;
}): "ok" | "warning" | "exceeded" {
  if (decision === "hard_block") return "exceeded";
  if (decision === "soft_warn" || pctUsed >= 80) return "warning";

  return "ok";
}

function percentUsed(spentUsd: string, limitUsd: string): number {
  const limit = Number.parseFloat(limitUsd);

  if (!Number.isFinite(limit) || limit <= 0) return 0;

  return (Number.parseFloat(spentUsd) / limit) * 100;
}

/**
 * The scope codes the banner and the command line's budget box accept.
 * Virtual-key blocks read as "personal" in both.
 */
function normalizeScope(scope: string): string {
  const normalized = scope.toLowerCase();

  return normalized === "virtual_key" ? "personal" : normalized;
}
