/**
 * @see ADR-021 (scopeType+scopeId is the single inline source of truth)
 * Business logic for GatewayBudget CRUD + the pre-request projective check called from the Go gateway. Every budget row belongs to exactly one organization.
 */

import { createLogger } from "@langwatch/observability";
import type {
  GatewayBudget,
  GatewayBudgetWindow,
  PrismaClient,
} from "@langwatch/prisma-client/generated";
import { Prisma } from "@langwatch/prisma-client/generated";
import { PrismaGatewayAuditRepository } from "./prisma.gateway-audit.repository";
import {
  serializeRowForAudit,
  budgetPeriodFloorMs,
  attributedUserBucketScopeId,
  bucketScopeIdFor,
  budgetAppliesToProvider,
  GatewayWindow,
  GatewayBudgetCycleAnchorInvalidError,
  type GatewayBudgetPageInput,
  type GatewayBudgetResolutionTarget,
  type GatewayBudgetResource,
  type GatewayBudgetScopeTarget,
  type GatewayResolvedBudget,
  GatewayBudgetNotFoundError,
  GatewayGroupBudgetUnsupportedError,
  GatewayScopeOrgMismatchError,
  translateExternalIdConflict,
  VirtualKeyNotFoundError,
  usdToNanoUsd,
  identityPatchData,
  type ResourceMetadata,
} from "@langwatch/gateway-contract";
import type {
  BudgetBucketBoundary,
  GatewayBudgetSpendPort,
} from "../../ports/gateway-budget-spend.port";
import { PrismaGatewayBudgetResolutionRepository } from "./prisma.gateway-budget-resolution.repository";
import { PrismaGatewayBudgetScopeReachRepository } from "./prisma.gateway-budget-scope-reach.repository";
import type { GatewayBudgetScopeReach } from "../gateway-budget.repository";
import { PrismaGatewayChangeEventsRepository } from "./prisma.gateway-change-event.repository";
import {
  type BudgetScopeTargetInfo,
  PrismaGatewayBudgetScopeTargetRepository,
} from "./prisma.gateway-budget-scope-target.repository";
import { GatewayWirePaginationAdapter } from "../../adapters/gateway-wire-pagination.adapter";
import {
  GatewayBudgetRepository,
  type AttributedUserBudgetTemplate,
  type BucketBoundaryRow,
  type GatewayBudgetCheckReadInput,
  type GatewayBudgetReadInput,
  type GatewayKeyReachCandidate,
  type GatewayOrganizationBudgetReadInput,
  type GatewayProjectBudgetReadInput,
  type GatewayVirtualKeyProjectScope,
} from "../gateway-budget.repository";
import type { ProjectIdentity } from "@langwatch/project-contract";

const wirePages = GatewayWirePaginationAdapter.create();
const logger = createLogger("langwatch:gateway:budget-service");

/**
 * A budget row plus the per-person standing only a fanned-out budget has: an ATTRIBUTED_USER template is one allowance per end user, so its honest headline is how many people it saw this period and how many are over cap, not one total. Every other scope leaves both fields absent.
 */
export type GatewayBudgetWithSeats = GatewayBudget & {
  /**
   * Current-period spend as the ledger's nano-USD integer, present whenever read from the ledger. spentUsd on the same row is this rendered, so the two agree — a consumer publishing an integer takes it from here, not re-derived from decimals which can't recover digits the decimal never had.
   */
  spentNanoUsd?: number;
  /** Distinct end users with spend against this template this period. */
  endUsersSeen?: number;
  /** How many of those are at or over the per-person limit. */
  endUsersOver?: number;
};

export type BudgetHealth = {
  budget: GatewayBudgetWithSeats;
  spendAvailable: boolean;
  readAt: Date;
  unreachableByAnyKey: boolean;
};

export type BudgetListWithHealth = {
  budgets: GatewayBudgetWithSeats[];
  /**
   * False when spend could not be totalled. Consumers must say so rather
   * than render the untotalled figure as if it were real spend.
   */
  spendAvailable: boolean;
  /**
   * Instant the spend above was read at. A caller rendering the period beside the figure must resolve it at THIS instant, not the wall clock, or a boundary crossed in between prints the new period next to the old spend.
   */
  readAt: Date;
  scopeReach: Map<string, GatewayBudgetScopeReach>;
};

export type GatewayProjectBudgetScopeInput = {
  organizationId: string;
  teamId: string;
  projectId: string;
};

export type BudgetScope =
  | { kind: "ORGANIZATION"; organizationId: string }
  | { kind: "TEAM"; teamId: string }
  | { kind: "PROJECT"; projectId: string }
  | { kind: "VIRTUAL_KEY"; virtualKeyId: string }
  | { kind: "PRINCIPAL"; principalUserId: string }
  | { kind: "GROUP"; groupId: string }
  // Template: each distinct external end user on the anchor gets the
  // budget's limit per window. The anchor is a virtual key or a project.
  | {
      kind: "ATTRIBUTED_USER";
      anchorVirtualKeyId?: string;
      anchorProjectId?: string;
    };

export type CreateBudgetInput = {
  organizationId: string;
  scope: BudgetScope;
  name: string;
  description?: string | null;
  window: GatewayBudgetWindow;
  limitUsd: number | string | Prisma.Decimal;
  onBreach?: "BLOCK" | "WARN";
  timezone?: string | null;
  /**
   * ModelProvider row id the budget counts and constrains. Null (the
   * default) counts every provider. Orthogonal to the scope target, which
   * is what makes the full target x provider matrix expressible.
   */
  providerKey?: string | null;
  /** The caller's own id for this budget; must be free within the org. */
  externalId?: string | null;
  /** Customer-owned bookkeeping. Never read by the gateway. */
  metadata?: ResourceMetadata;
  /**
   * Phases a cyclic window off this instant instead of the calendar (e.g. a MONTH anchored 17th 09:00 UTC rolls every 17th 09:00 UTC). Null (default) keeps calendar alignment. Rejected on TOTAL and MANUAL, which don't cycle.
   */
  cycleAnchorAt?: Date | null;
  /**
   * Keeps a budget no active key can reach, instead of refusing it.
   * Provisioning ahead of the keys that will use it is legitimate; the
   * refusal is a guardrail, not a prohibition.
   */
  allowUnreachable?: boolean;
  actorUserId: string;
};

export type UpdateBudgetInput = {
  id: string;
  organizationId: string;
  name?: string;
  description?: string | null;
  limitUsd?: number | string | Prisma.Decimal;
  onBreach?: "BLOCK" | "WARN";
  timezone?: string | null;
  /** Undefined leaves it alone; null clears it; a value claims it. */
  externalId?: string | null;
  /** Undefined leaves the stored map alone; a value REPLACES it wholesale. */
  metadata?: ResourceMetadata;
  actorUserId: string;
};

export type ArchiveBudgetInput = {
  id: string;
  organizationId: string;
  actorUserId: string;
};

export type BudgetLedgerLine = {
  id: string;
  virtualKeyId: string;
  virtualKeyName: string;
  virtualKeyPrefix: string;
  amountUsd: string;
  model: string;
  status: "SUCCESS" | "PROVIDER_ERROR" | "BLOCKED_BY_GUARDRAIL" | "CANCELLED";
  occurredAt: string;
};

export type BudgetDetail = {
  budget: GatewayBudgetWithSeats;
  scopeTarget: BudgetScopeTargetInfo;
  recentLedger: Array<{
    id: string;
    virtualKeyId: string;
    amountUsd: Prisma.Decimal;
    model: string;
    status: "SUCCESS" | "PROVIDER_ERROR" | "BLOCKED_BY_GUARDRAIL" | "CANCELLED";
    occurredAt: Date;
    virtualKey: { name: string; displayPrefix: string } | null;
  }>;
  /** False when spend could not be totalled, so `spentUsd` is not real spend. */
  spendAvailable: boolean;
  /** True when no active key can produce traffic this budget matches. */
  unreachableByAnyKey: boolean;
};

export type BudgetCheckDecision = "allow" | "soft_warn" | "hard_block";

export type BudgetCheckInput = {
  organizationId: string;
  // Post-collapse: a VK with no PROJECT scope (TEAM/ORG-only) and no
  // governance-project fallback has no trace project; the corresponding
  // TEAM/PROJECT-scoped budgets are simply skipped from the OR-clause.
  teamId: string | null;
  projectId: string | null;
  virtualKeyId: string;
  principalUserId?: string | null;
  projectedCostUsd: number | string;
  /**
   * The provider this request would dispatch to, when known. Given it, provider-filtered budgets are consulted; without it only unfiltered ones are — so a provider filter can never block a request never headed there.
   */
  providerKey?: string | null;
};

export type BudgetCheckResult = {
  decision: BudgetCheckDecision;
  warnings: Array<{ scope: string; pctUsed: number; limitUsd: string }>;
  blockReason: string | null;
  blockedBy: Array<{
    budgetId: string;
    scope: string;
    scopeId: string;
    window: string;
    limitUsd: string;
    spentUsd: string;
  }>;
  /**
   * Raw per-scope ledger used by the gateway's `Checker.ApplyLive` to
   * reconcile near-limit cached preview against live DB state (contract §4.4).
   * Includes every applicable budget, not just those in warn/block.
   */
  scopes: Array<{
    scope: string;
    scopeId: string;
    window: string;
    spentUsd: string;
    limitUsd: string;
  }>;
};

/**
 * The client slice the whole budget chain binds to — its own writes plus the audit, change-feed, reach, resolution and scope-target repositories it builds. Stated here, where the generated client may be named, so the composition adapter can declare what Gateway persistence needs without importing the generated declaration itself.
 */
export type GatewayBudgetDatabase = Pick<
  PrismaClient,
  | "$transaction"
  | "auditLog"
  | "gatewayBudget"
  | "gatewayBudgetBucketBoundary"
  | "gatewayChangeEvent"
  | "group"
  | "groupMembership"
  | "modelProvider"
  | "organization"
  | "organizationUser"
  | "team"
  | "user"
  | "virtualKey"
  | "virtualKeyScope"
>;

export class PrismaGatewayBudgetRepository extends GatewayBudgetRepository {
  constructor(
    private readonly prisma: GatewayBudgetDatabase,
    private readonly changeEvents = new PrismaGatewayChangeEventsRepository(prisma),
    private readonly auditLog = new PrismaGatewayAuditRepository(prisma),
    private readonly scopeReach = PrismaGatewayBudgetScopeReachRepository.create(prisma),
    private readonly chRepo?: GatewayBudgetSpendPort,
  ) {
    super();
  }

  static create(
    database: GatewayBudgetDatabase,
    chRepo?: GatewayBudgetSpendPort,
  ): PrismaGatewayBudgetRepository {
    return new PrismaGatewayBudgetRepository(
      database,
      new PrismaGatewayChangeEventsRepository(database),
      new PrismaGatewayAuditRepository(database),
      PrismaGatewayBudgetScopeReachRepository.create(database),
      chRepo,
    );
  }

  async resolveApplicableBudgets(
    input: GatewayBudgetResolutionTarget,
  ): Promise<GatewayResolvedBudget[]> {
    const resolved =
      await PrismaGatewayBudgetResolutionRepository.create().resolveApplicableBudgets({
        client: this.prisma,
        target: input,
      });

    return resolved.map((entry) => ({
      budget: toGatewayBudgetResource(entry.budget),
      bucketScopeId: entry.bucketScopeId,
      principalUserId: entry.principalUserId,
      groupId: entry.groupId,
      endUserId: entry.endUserId,
    }));
  }

  async resolveScopeTargets(
    budgets: Array<{ scopeType: string; scopeId: string }>,
    organizationId: string | null,
    projects: ProjectIdentity[],
    virtualKeyProjectScopes: GatewayVirtualKeyProjectScope[],
  ): Promise<Map<string, GatewayBudgetScopeTarget>> {
    const targets =
      await PrismaGatewayBudgetScopeTargetRepository.create().resolveScopeTargetsBatch(
        this.prisma,
        budgets,
        organizationId,
        projects,
        virtualKeyProjectScopes,
      );

    return new Map(targets);
  }

  listVirtualKeyProjectScopes(input: {
    organizationId: string | null;
    virtualKeyIds: string[];
  }): Promise<GatewayVirtualKeyProjectScope[]> {
    return PrismaGatewayBudgetScopeTargetRepository.create().listVirtualKeyProjectScopes(
      this.prisma,
      input.organizationId,
      input.virtualKeyIds,
    );
  }

  async list(input: GatewayOrganizationBudgetReadInput): Promise<GatewayBudgetWithSeats[]> {
    const budgets = await this.prisma.gatewayBudget.findMany({
      where: { organizationId: input.organizationId, archivedAt: null },
      orderBy: [{ scopeType: "asc" }, { createdAt: "desc" }],
    });
    return await this.applyClickHouseSpend(budgets, input);
  }

  async listForProject(input: GatewayProjectBudgetReadInput): Promise<GatewayBudgetWithSeats[]> {
    const budgets = await this.prisma.gatewayBudget.findMany({
      where: {
        organizationId: input.organizationId,
        archivedAt: null,
        OR: [
          { scopeType: "ORGANIZATION", scopeId: input.organizationId },
          { scopeType: "TEAM", scopeId: input.teamId },
          { scopeType: "PROJECT", scopeId: input.projectId },
        ],
      },
      orderBy: [{ scopeType: "asc" }, { createdAt: "desc" }],
    });
    return await this.applyClickHouseSpend(budgets, input);
  }

  /**
   * Decorates budgets with current-period CH ledger spend so the list view shows real spend instead of the stale post-cutover GatewayBudget.spentUsd column, falling back to PG when CH isn't wired (mirrors check()). CH is keyed by TenantId = the project a trace landed in, but ORG/TEAM/PRINCIPAL budgets accumulate across MULTIPLE projects, so this sums across every project in the org via getSpendForBudgetsAcrossTenants.
   */
  private async applyClickHouseSpend(
    budgets: GatewayBudget[],
    input: GatewayOrganizationBudgetReadInput,
  ): Promise<GatewayBudgetWithSeats[]> {
    const { budgets: decorated } = await this.applyClickHouseSpendWithHealth(budgets, input);
    return decorated;
  }

  /**
   * As applyClickHouseSpend, but also reports whether the figures actually came from the ledger. GatewayBudget.spentUsd in Postgres has had no writer since the ledger cutover, so falling back to it renders a confident $0.00/$X, 0% on a budget that isn't really being totalled or enforced — callers must surface spendAvailable: false instead of showing that zero.
   */
  private async applyClickHouseSpendWithHealth(
    budgets: GatewayBudget[],
    input: GatewayOrganizationBudgetReadInput,
  ): Promise<{
    budgets: GatewayBudgetWithSeats[];
    spendAvailable: boolean;
    readAt: Date;
  }> {
    // One instant for every read below, so the per-person breakdown cannot
    // land in a later period than the totals it sits beside, and so the
    // period a caller reports is the one the figure was summed in.
    const now = new Date();
    if (budgets.length === 0) {
      return { budgets, spendAvailable: true, readAt: now };
    }
    if (!this.chRepo) return { budgets, spendAvailable: false, readAt: now };

    const { organizationId, tenantIds } = input;
    // No project means nothing has ever been able to emit a ledger row, so
    // zero is the true total rather than a missing one.
    if (tenantIds.length === 0) {
      return { budgets, spendAvailable: true, readAt: now };
    }

    const boundariesByBudget = await this.bucketBoundaries(budgets, organizationId);

    let spends;
    let seats: Map<string, { seen: number; over: number }>;
    try {
      spends = await this.chRepo.getSpendForBudgetsAcrossTenants(tenantIds, budgets, now);
      seats = await this.seatStandings({
        budgets,
        tenantIds,
        boundariesByBudget,
        now,
      });
    } catch (error) {
      logger.error(
        { organizationId, budgetCount: budgets.length, error },
        "failed to read gateway budget spend totals",
      );
      return { budgets, spendAvailable: false, readAt: now };
    }

    const spendByBudget = new Map(spends.map((s) => [s.budgetId, s]));
    return {
      spendAvailable: true,
      readAt: now,
      budgets: budgets.map((b) => {
        const ch = spendByBudget.get(b.id);
        const seat = seats.get(b.id);
        const withSeats: GatewayBudgetWithSeats = seat
          ? { ...b, endUsersSeen: seat.seen, endUsersOver: seat.over }
          : b;
        if (ch === undefined) return withSeats;
        return {
          ...withSeats,
          spentNanoUsd: ch.spentNanoUsd,
          spentUsd: new Prisma.Decimal(ch.spentUsd),
        };
      }),
    };
  }

  /**
   * Per-bucket period boundaries for every per-person template in the set,
   * batch-loaded so the spend read stays one round-trip per template.
   */
  async findAttributedUserTemplates({
    organizationId,
    virtualKeyId,
  }: {
    organizationId: string;
    virtualKeyId?: string;
  }): Promise<AttributedUserBudgetTemplate[]> {
    return this.prisma.gatewayBudget.findMany({
      where: {
        organizationId,
        scopeType: "ATTRIBUTED_USER",
        archivedAt: null,
        ...(virtualKeyId ? { scopeId: virtualKeyId } : {}),
      },
      select: {
        id: true,
        scopeType: true,
        scopeId: true,
        providerKey: true,
        window: true,
        onBreach: true,
        limitUsd: true,
        currentPeriodStartedAt: true,
        resetsAt: true,
        lastResetAt: true,
        cycleAnchorAt: true,
      },
    });
  }

  async findBucketBoundaries({
    organizationId,
    budgetIds,
  }: {
    organizationId: string;
    budgetIds: string[];
  }): Promise<BucketBoundaryRow[]> {
    if (budgetIds.length === 0) return [];

    return this.prisma.gatewayBudgetBucketBoundary.findMany({
      where: { organizationId, budgetId: { in: budgetIds } },
      select: { budgetId: true, bucketScopeId: true, periodStartedAt: true },
    });
  }

  private async bucketBoundaries(
    budgets: GatewayBudget[],
    organizationId: string,
  ): Promise<Map<string, BudgetBucketBoundary[]>> {
    const templateIds = budgets.filter((b) => b.scopeType === "ATTRIBUTED_USER").map((b) => b.id);
    const byBudget = new Map<string, BudgetBucketBoundary[]>();
    if (templateIds.length === 0) return byBudget;

    const rows = await this.prisma.gatewayBudgetBucketBoundary.findMany({
      where: { organizationId, budgetId: { in: templateIds } },
      select: { budgetId: true, bucketScopeId: true, periodStartedAt: true },
    });
    for (const row of rows) {
      const list = byBudget.get(row.budgetId) ?? [];
      list.push({
        bucketScopeId: row.bucketScopeId,
        periodStartedAt: row.periodStartedAt,
      });
      byBudget.set(row.budgetId, list);
    }
    return byBudget;
  }

  /**
   * How many people each per-person template watches, and how many are over their own cap. Over-cap is >=, the same comparator the gateway refuses a request on, so a seat the list calls over is one actually being stopped.
   */
  private async seatStandings(args: {
    budgets: GatewayBudget[];
    tenantIds: string[];
    boundariesByBudget: Map<string, BudgetBucketBoundary[]>;
    now: Date;
  }): Promise<Map<string, { seen: number; over: number }>> {
    const out = new Map<string, { seen: number; over: number }>();
    if (!this.chRepo) return out;

    for (const budget of args.budgets) {
      if (budget.scopeType !== "ATTRIBUTED_USER") continue;
      const buckets = await this.chRepo.getBucketSpendBreakdownForBudget({
        budget,
        tenantIds: args.tenantIds,
        boundaries: args.boundariesByBudget.get(budget.id) ?? [],
        now: args.now,
      });
      // Compared as integers, in the unit both sides are exact in. A seat
      // one nano-USD under its cap is under it, and a float comparison at
      // these magnitudes is what decides that wrongly.
      const limitNanoUsd = usdToNanoUsd(budget.limitUsd);
      out.set(budget.id, {
        seen: buckets.length,
        over: buckets.filter((b) => BigInt(b.spentNanoUsd) >= limitNanoUsd).length,
      });
    }
    return out;
  }

  /**
   * Budgets for the organization's list view, with the two health signals
   * the view cannot render honestly without: whether spend could be totalled
   * at all, and which budgets no active key can ever spend against.
   */
  async listWithHealth(input: GatewayOrganizationBudgetReadInput): Promise<BudgetListWithHealth> {
    const rows = await this.prisma.gatewayBudget.findMany({
      where: { organizationId: input.organizationId, archivedAt: null },
      orderBy: [{ scopeType: "asc" }, { createdAt: "desc" }],
    });
    return await this.decorateWithHealth(rows, input);
  }

  /**
   * One page of the org's budgets, newest first, keyed (createdAt, id). Scope-type filter is pushed into the query, not applied to the page afterwards — filtering post-page would make limit mean "rows examined" instead of "rows returned", silently shorting a caller asking for 50 group budgets.
   */
  async listPageWithHealth(
    args: GatewayBudgetPageInput & GatewayOrganizationBudgetReadInput,
  ): Promise<BudgetListWithHealth> {
    const rows = await this.prisma.gatewayBudget.findMany({
      where: {
        organizationId: args.organizationId,
        archivedAt: null,
        ...(args.scopeTypes ? { scopeType: { in: args.scopeTypes } } : {}),
        ...(args.externalId !== undefined ? { externalId: args.externalId } : {}),
        ...(args.cursor
          ? {
              OR: wirePages.keysetAfter([
                {
                  name: "createdAt",
                  value: args.cursor.createdAt,
                  direction: "desc",
                },
                { name: "id", value: args.cursor.id, direction: "desc" },
              ]),
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: args.limit,
    });
    return await this.decorateWithHealth(rows, args);
  }

  /** As listWithHealth, for the budgets that apply to one project. */
  async listForProjectWithHealth(
    input: GatewayProjectBudgetReadInput,
  ): Promise<BudgetListWithHealth> {
    const rows = await this.prisma.gatewayBudget.findMany({
      where: {
        organizationId: input.organizationId,
        archivedAt: null,
        OR: [
          { scopeType: "ORGANIZATION", scopeId: input.organizationId },
          { scopeType: "TEAM", scopeId: input.teamId },
          { scopeType: "PROJECT", scopeId: input.projectId },
        ],
      },
      orderBy: [{ scopeType: "asc" }, { createdAt: "desc" }],
    });
    return await this.decorateWithHealth(rows, input);
  }

  private async decorateWithHealth(
    rows: GatewayBudget[],
    input: GatewayOrganizationBudgetReadInput,
  ): Promise<BudgetListWithHealth> {
    const { budgets, spendAvailable, readAt } = await this.applyClickHouseSpendWithHealth(
      rows,
      input,
    );
    return { budgets, spendAvailable, readAt, scopeReach: new Map() };
  }

  /**
   * One budget in exactly the shape listWithHealth returns rows in, including whether the spend figure is real. Dropping spendAvailable here would render an untotalled spentUsd as real spend — the same confusion the list already refuses to create.
   */
  async tryGetWithHealth(input: GatewayBudgetReadInput): Promise<BudgetHealth | null> {
    const row = await this.prisma.gatewayBudget.findFirst({
      where: { id: input.id, organizationId: input.organizationId, archivedAt: null },
    });
    if (!row) return null;
    const { budgets, spendAvailable, readAt, scopeReach } = await this.decorateWithHealth(
      [row],
      input,
    );
    return {
      budget: budgets[0] ?? row,
      spendAvailable,
      readAt,
      unreachableByAnyKey: scopeReach.get(row.id)?.reachable === false,
    };
  }

  async tryGet(input: GatewayBudgetReadInput): Promise<GatewayBudgetWithSeats | null> {
    const budget = await this.tryGetStored(input.id, input.organizationId);
    if (!budget) return null;
    const [decorated] = await this.applyClickHouseSpend([budget], input);
    return decorated ?? budget;
  }

  private tryGetStored(id: string, organizationId: string): Promise<GatewayBudget | null> {
    return this.prisma.gatewayBudget.findFirst({ where: { id, organizationId } });
  }

  /**
   * Budget plus resolved scope-target label (human-friendly name for the scope FK) and the last 20 ledger entries, for the detail page — one round-trip per scope kind so the UI doesn't chain queries.
   */
  async tryGetDetail(input: GatewayBudgetReadInput): Promise<BudgetDetail | null> {
    const row = await this.prisma.gatewayBudget.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
    });
    if (!row) return null;
    const { budgets, spendAvailable, scopeReach } = await this.decorateWithHealth([row], input);
    const budget = budgets[0] ?? row;

    const scopeTarget: BudgetScopeTargetInfo = {
      kind: budget.scopeType,
      id: budget.scopeId,
      name: budget.scopeId,
      secondary: null,
    };

    // Recent ledger entries come from ClickHouse
    // (gateway_budget_ledger_events). The CH events table doesn't carry
    // the VK name/displayPrefix fields, so we resolve those via a
    // single Prisma round-trip on the distinct VK ids in the slice.
    let recentLedger: BudgetDetail["recentLedger"] = [];
    if (this.chRepo) {
      // The ledger is sharded on TenantId = the project the trace landed
      // in, and org/team/principal/group budgets accrue rows across
      // every project in the org, so the read fans out over the same
      // tenant set the utilization read uses. The BudgetId filter keeps
      // narrower scopes exact.
      const tenantIds = input.tenantIds;
      const events =
        tenantIds.length > 0
          ? await this.chRepo.recentEventsForBudget(tenantIds, budget.id, 20)
          : [];
      const vkIds = Array.from(new Set(events.map((e) => e.virtualKeyId)));
      const vks = vkIds.length
        ? await this.prisma.virtualKey.findMany({
            where: { id: { in: vkIds } },
            select: { id: true, name: true, displayPrefix: true },
          })
        : [];
      const vkById = new Map(vks.map((v) => [v.id, v]));
      recentLedger = events.map((e) => ({
        id: e.id,
        virtualKeyId: e.virtualKeyId,
        amountUsd: new Prisma.Decimal(e.amountUsd),
        model: e.model,
        status: e.status,
        occurredAt: e.occurredAt,
        virtualKey: vkById.get(e.virtualKeyId)
          ? {
              name: vkById.get(e.virtualKeyId)!.name,
              displayPrefix: vkById.get(e.virtualKeyId)!.displayPrefix,
            }
          : null,
      }));
    }

    return {
      budget,
      scopeTarget,
      recentLedger,
      spendAvailable,
      unreachableByAnyKey: scopeReach.get(budget.id)?.reachable === false,
    };
  }

  /**
   * The wire spelling of each reach-checked scope, so the refusal's
   * `meta.scope_type` can only ever be one of the three the documentation
   * lists.
   */
  private static readonly REACH_CHECKED_SCOPE_NAMES = {
    TEAM: "team",
    PROJECT: "project",
    GROUP: "group",
  } as const;

  /**
   * Whether any active key can produce traffic this scope matches. Read separately from the create guard (which only runs for the three scopes it can refuse), since omitting the field from create's response would make it disagree with the row the very next read returns — and callers do compare those.
   */
  listScopeReachCandidates(organizationId: string): Promise<GatewayKeyReachCandidate[]> {
    return this.scopeReach.list(organizationId);
  }

  async create(input: CreateBudgetInput): Promise<GatewayBudget> {
    // An anchor only means something on a window that rolls. Checked before
    // any lookup, since it needs nothing but the request.
    const cycleAnchorAt = input.cycleAnchorAt ?? null;
    if (cycleAnchorAt && !GatewayWindow.isCyclicWindow(input.window)) {
      throw new GatewayBudgetCycleAnchorInvalidError(input.window.toLowerCase());
    }

    // Cross-org guard for PRINCIPAL budgets: the named user must belong to
    // the budget's organization, or the FK to User would pass while the
    // budget silently never matched the user's traffic (PRINCIPAL spans only
    // their org's VKs). Spec: specs/ai-gateway/budgets-principal-cascade.feature.
    if (input.scope.kind === "PRINCIPAL") {
      const membership = await this.prisma.organizationUser.findFirst({
        where: {
          organizationId: input.organizationId,
          userId: input.scope.principalUserId,
        },
        select: { userId: true },
      });
      if (!membership) {
        throw new GatewayScopeOrgMismatchError("user");
      }
    }

    // Cross-org guard for TEAM/PROJECT budgets: the scoped team/project must
    // belong to the budget's organization — the scope id is request-supplied
    // and the Team/Project FK is org-agnostic, so without this a caller could
    // target another tenant's team or project. Mirrors the PRINCIPAL guard above.
    if (input.scope.kind === "TEAM") {
      const team = await this.prisma.team.findFirst({
        where: { id: input.scope.teamId, organizationId: input.organizationId },
        select: { id: true },
      });
      if (!team) {
        throw new GatewayScopeOrgMismatchError("team");
      }
    }
    // Cross-org + product-managed guard for VIRTUAL_KEY budgets: the scope id
    // is request-supplied, and a product-managed VK (purpose != USER, e.g. the
    // Langy VK) isn't the customer's to constrain — a $0.01 BLOCK budget on it
    // would deny every turn. Not-found rather than forbidden, so the response
    // never confirms the id exists.
    if (input.scope.kind === "VIRTUAL_KEY") {
      const vk = await this.prisma.virtualKey.findFirst({
        where: {
          id: input.scope.virtualKeyId,
          organizationId: input.organizationId,
        },
        select: { purpose: true },
      });
      if (vk?.purpose !== "USER") {
        throw new VirtualKeyNotFoundError();
      }
    }

    if (input.scope.kind === "GROUP") {
      // A GROUP budget is one enforcement bucket per member, which only exists
      // on the ClickHouse spend path — without it, check() would enforce each
      // member against the whole group's combined PG spentUsd, a different
      // control than the admin asked for. Refuse rather than create a cap that
      // can't mean what it says. Spec: specs/ai-gateway/gateway-budget-targeting.feature.
      if (!this.chRepo) {
        throw new GatewayGroupBudgetUnsupportedError();
      }
      // Cross-org guard, mirroring the TEAM / PROJECT / PRINCIPAL guards:
      // the scope id is request-supplied, so without this a caller could
      // put a per-member budget on another tenant's group.
      const group = await this.prisma.group.findFirst({
        where: {
          id: input.scope.groupId,
          organizationId: input.organizationId,
        },
        select: { id: true },
      });
      if (!group) {
        throw new GatewayScopeOrgMismatchError("group");
      }
    }

    if (input.scope.kind === "ATTRIBUTED_USER") {
      // Per-end-user buckets are unbounded-cardinality and only exist on
      // the ClickHouse spend path; same refusal as GROUP, for the same
      // reason: a template that cannot mean what it says must not exist.
      if (!this.chRepo) {
        throw new GatewayGroupBudgetUnsupportedError();
      }
      const vkAnchor = input.scope.anchorVirtualKeyId;
      const projectAnchor = input.scope.anchorProjectId;
      if ((vkAnchor ? 1 : 0) + (projectAnchor ? 1 : 0) !== 1) {
        throw new GatewayScopeOrgMismatchError("attributed-user anchor");
      }
      // Cross-org guard on the anchor, mirroring VIRTUAL_KEY / PROJECT.
      if (vkAnchor) {
        const vk = await this.prisma.virtualKey.findFirst({
          where: {
            id: vkAnchor,
            organizationId: input.organizationId,
            purpose: "USER",
          },
          select: { id: true },
        });
        if (!vk) {
          throw new GatewayScopeOrgMismatchError("virtual key");
        }
      }
    }

    // Provider-filtered budgets reference a ModelProvider row. The id is
    // request-supplied, so pin it to the budget's own organization: a
    // cross-org id would create a filter that can never match this org's
    // dispatches and silently count nothing.
    if (input.providerKey) {
      const provider = await this.prisma.modelProvider.findFirst({
        where: {
          id: input.providerKey,
          organizationId: input.organizationId,
        },
        select: { id: true },
      });
      if (!provider) {
        throw new GatewayScopeOrgMismatchError("model provider");
      }
    }

    const resetsAt = GatewayWindow.nextBoundaryFor({
      budget: { window: input.window, cycleAnchorAt },
    });
    const projectId = resolveProjectFromScope(input.scope);

    const created = await this.prisma
      .$transaction(async (tx) => {
        const row = await tx.gatewayBudget.create({
          data: {
            organizationId: input.organizationId,
            scopeType: input.scope.kind,
            scopeId: scopeIdForScope(input.scope),
            name: input.name,
            description: input.description ?? null,
            window: input.window,
            limitUsd: new Prisma.Decimal(input.limitUsd.toString()),
            onBreach: input.onBreach ?? "BLOCK",
            timezone: input.timezone ?? null,
            providerKey: input.providerKey ?? null,
            externalId: input.externalId ?? null,
            ...identityPatchData({ metadata: input.metadata }),
            cycleAnchorAt,
            resetsAt,
            currentPeriodStartedAt: new Date(),
            createdById: input.actorUserId,
          },
        });
        await this.changeEvents.append(
          {
            organizationId: input.organizationId,
            projectId,
            kind: "BUDGET_CREATED",
            budgetId: row.id,
          },
          tx,
        );
        await this.auditLog.append(
          {
            organizationId: input.organizationId,
            projectId,
            actorUserId: input.actorUserId,
            action: "gateway.budget.created",
            targetKind: "budget",
            targetId: row.id,
            after: serializeRowForAudit(row),
          },
          tx,
        );
        return row;
      })
      // As on the virtual-key create: the index decides, so the refusal is
      // read off its violation rather than off a racy pre-flight SELECT.
      .catch((error: unknown) => translateExternalIdConflict(error, "budget", input.externalId));

    return created;
  }

  async update(input: UpdateBudgetInput): Promise<GatewayBudget> {
    const existing = await this.tryGetStored(input.id, input.organizationId);
    if (!existing) throw new GatewayBudgetNotFoundError();
    const before = serializeRowForAudit(existing);

    return this.prisma
      .$transaction(async (tx) => {
        const updated = await tx.gatewayBudget.update({
          where: { id: input.id },
          data: {
            name: input.name ?? existing.name,
            description: input.description === undefined ? existing.description : input.description,
            limitUsd:
              input.limitUsd !== undefined
                ? new Prisma.Decimal(input.limitUsd.toString())
                : existing.limitUsd,
            onBreach: input.onBreach ?? existing.onBreach,
            timezone: input.timezone === undefined ? existing.timezone : input.timezone,
            ...identityPatchData(input),
          },
        });
        await this.changeEvents.append(
          {
            organizationId: input.organizationId,
            kind: "BUDGET_UPDATED",
            budgetId: updated.id,
          },
          tx,
        );
        await this.auditLog.append(
          {
            organizationId: input.organizationId,
            actorUserId: input.actorUserId,
            action: "gateway.budget.updated",
            targetKind: "budget",
            targetId: updated.id,
            before,
            after: serializeRowForAudit(updated),
          },
          tx,
        );
        return updated;
      })
      .catch((error: unknown) => translateExternalIdConflict(error, "budget", input.externalId));
  }

  async archive(input: ArchiveBudgetInput): Promise<GatewayBudget> {
    const existing = await this.tryGetStored(input.id, input.organizationId);
    if (!existing) throw new GatewayBudgetNotFoundError();
    const before = serializeRowForAudit(existing);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.gatewayBudget.update({
        where: { id: input.id },
        data: { archivedAt: new Date() },
      });
      await this.changeEvents.append(
        {
          organizationId: input.organizationId,
          kind: "BUDGET_DELETED",
          budgetId: updated.id,
        },
        tx,
      );
      await this.auditLog.append(
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "gateway.budget.deleted",
          targetKind: "budget",
          targetId: updated.id,
          before,
          after: serializeRowForAudit(updated),
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * Single-end-user branch of {@link reset}: moves one bucket's boundary on an attributed-user template, audited under the same gateway.budget.reset action carrying the reset bucket. The template's own boundary and every other bucket stay put.
   */
  private async resetAttributedUserBucket(params: {
    existing: GatewayBudget;
    endUserId: string;
    organizationId: string;
    actorUserId: string;
    reason?: string | null;
    before: unknown;
    now: Date;
  }): Promise<void> {
    const { existing, organizationId, before, now } = params;
    if (existing.scopeType !== "ATTRIBUTED_USER") {
      throw new GatewayScopeOrgMismatchError("attributed-user budget");
    }
    const bucketScopeId = bucketScopeIdFor(
      existing,
      attributedUserBucketScopeId(existing.scopeId, params.endUserId),
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.gatewayBudgetBucketBoundary.upsert({
        where: {
          budgetId_bucketScopeId: {
            budgetId: existing.id,
            bucketScopeId,
          },
        },
        create: {
          organizationId,
          budgetId: existing.id,
          bucketScopeId,
          periodStartedAt: now,
        },
        update: { periodStartedAt: now },
      });
      await this.auditLog.append(
        {
          organizationId,
          actorUserId: params.actorUserId,
          action: "gateway.budget.reset",
          targetKind: "budget",
          targetId: existing.id,
          before,
          after: {
            row: serializeRowForAudit(existing),
            resetBucketScopeId: bucketScopeId,
            resetReason: params.reason ?? null,
          },
        },
        tx,
      );
    });
  }

  /**
   * Moves a budget's period boundary to now. NEVER mutates recorded spend (ledger + billing events are immutable, so reconciliation is unaffected) — the boundary move alone restarts the current-period figure. Calendar windows truncate the running period (next boundary stays calendar); MANUAL windows stay open until the next reset. With endUserId, only that bucket's boundary moves (the template's own stays) — the single-user mid-cycle reset.
   */
  async reset(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
    endUserId?: string | null;
    reason?: string | null;
  }): Promise<GatewayBudget> {
    const existing = await this.tryGetStored(input.id, input.organizationId);
    if (!existing) throw new GatewayBudgetNotFoundError();
    const before = serializeRowForAudit(existing);
    const now = new Date();

    if (input.endUserId) {
      await this.resetAttributedUserBucket({
        existing,
        endUserId: input.endUserId,
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        reason: input.reason,
        before,
        now,
      });
      return existing;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.gatewayBudget.update({
        where: { id: input.id },
        data: {
          currentPeriodStartedAt: now,
          lastResetAt: now,
          // A reset forgives the spend so far; it does not re-phase the
          // cycle, so an anchored budget reports the next boundary on its
          // own schedule rather than one window from this instant.
          resetsAt: GatewayWindow.nextBoundaryFor({ budget: existing, now }),
          // The current-period figure the bundle reads; the period just
          // restarted, so it is zero by definition. Ledger rows untouched.
          spentUsd: new Prisma.Decimal(0),
        },
      });
      // Anchor-wide reset clears any per-bucket boundaries: the whole
      // template starts a fresh period, including buckets that had their
      // own single-user resets inside the old one.
      await tx.gatewayBudgetBucketBoundary.deleteMany({
        where: { organizationId: input.organizationId, budgetId: existing.id },
      });
      await this.changeEvents.append(
        {
          organizationId: input.organizationId,
          kind: "BUDGET_UPDATED",
          budgetId: updated.id,
        },
        tx,
      );
      await this.auditLog.append(
        {
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "gateway.budget.reset",
          targetKind: "budget",
          targetId: updated.id,
          before,
          after: {
            row: serializeRowForAudit(updated),
            resetReason: input.reason ?? null,
          },
        },
        tx,
      );
      return updated;
    });
  }

  /**
   * Pre-request projective check: given `projected_cost_usd` would any
   * applicable scope breach? Does NOT mutate spend — that happens in the
   * post-response debit path (contract §4.5).
   */
  async check(input: GatewayBudgetCheckReadInput): Promise<BudgetCheckResult> {
    const projected = new Prisma.Decimal(input.projectedCostUsd.toString());

    // Same resolver the bundle and the debits process use, so what
    // enforces here is exactly what the key was told applies to it.
    const resolved = (
      await PrismaGatewayBudgetResolutionRepository.create().resolveApplicableBudgets({
        client: this.prisma,
        target: {
          organizationId: input.organizationId,
          teamId: input.teamId,
          projectId: input.projectId,
          virtualKeyId: input.virtualKeyId,
          principalUserId: input.principalUserId,
        },
      })
    ).filter((r) => budgetAppliesToProvider(r.budget, input.providerKey));
    const applicable = resolved.map((r) => r.budget);

    // Prefers ClickHouse spend (debit ledger) when wired, falls back to PG
    // spentUsd otherwise. CH rollup is keyed by (budget, current period) so
    // it self-resets at boundaries; PG needs shouldResetBudget since it
    // accumulates until reset. ORG/TEAM/PRINCIPAL budgets fan out across
    // every project in the org, not just the resolved trace project (mirrors materialiser's loadCurrentSpend).
    const chSpendByBudgetId = this.chRepo
      ? await (async () => {
          const tenantIds = input.tenantIds;
          if (tenantIds.length === 0) return new Map<string, string>();
          const spends = await this.chRepo!.getSpendForBudgetsAcrossTenants(
            tenantIds,
            resolved.map((r) => ({
              budgetId: r.budget.id,
              scope: r.budget.scopeType,
              scopeId: r.bucketScopeId,
              window: r.budget.window,
              match: "exact" as const,
              // The same floor the materialiser bakes into the bundle. A
              // MANUAL window has no calendar period to fall back on, so
              // without it this read totals the budget's whole lifetime and
              // decides against a number the gateway never enforces on.
              periodFloorMs: budgetPeriodFloorMs(r.budget),
            })),
          );
          return new Map(spends.map((s) => [s.budgetId, s.spentUsd] as const));
        })()
      : null;

    const now = new Date();
    const warnings: BudgetCheckResult["warnings"] = [];
    const blockedBy: BudgetCheckResult["blockedBy"] = [];
    const scopes: BudgetCheckResult["scopes"] = [];
    let blockReason: string | null = null;

    for (const budget of applicable) {
      const effectiveSpent = chSpendByBudgetId
        ? new Prisma.Decimal(chSpendByBudgetId.get(budget.id) ?? "0")
        : GatewayWindow.shouldResetBudget(budget.window, budget.resetsAt, now)
          ? new Prisma.Decimal(0)
          : budget.spentUsd;

      scopes.push({
        scope: budget.scopeType.toLowerCase(),
        scopeId: budget.scopeId,
        window: budget.window.toLowerCase(),
        spentUsd: effectiveSpent.toFixed(6),
        limitUsd: budget.limitUsd.toFixed(6),
      });

      const projectedTotal = effectiveSpent.plus(projected);
      if (projectedTotal.greaterThanOrEqualTo(budget.limitUsd)) {
        if (budget.onBreach === "BLOCK") {
          blockedBy.push(lineFor(budget, effectiveSpent));
          blockReason =
            blockReason ??
            `Budget exceeded for scope=${budget.scopeType.toLowerCase()} window=${budget.window.toLowerCase()}`;
        } else {
          warnings.push({
            scope: budget.scopeType.toLowerCase(),
            pctUsed: percentUsed(projectedTotal, budget.limitUsd),
            limitUsd: budget.limitUsd.toString(),
          });
        }
      } else if (
        percentUsed(projectedTotal, budget.limitUsd) >= 80 &&
        budget.onBreach === "BLOCK"
      ) {
        warnings.push({
          scope: budget.scopeType.toLowerCase(),
          pctUsed: percentUsed(projectedTotal, budget.limitUsd),
          limitUsd: budget.limitUsd.toString(),
        });
      }
    }

    const decision: BudgetCheckDecision =
      blockedBy.length > 0 ? "hard_block" : warnings.length > 0 ? "soft_warn" : "allow";

    return { decision, warnings, blockReason, blockedBy, scopes };
  }
}

function toGatewayBudgetResource(budget: GatewayBudget): GatewayBudgetResource {
  return {
    id: budget.id,
    organizationId: budget.organizationId,
    scopeType: budget.scopeType,
    scopeId: budget.scopeId,
    providerKey: budget.providerKey,
    name: budget.name,
    description: budget.description,
    window: budget.window,
    limitUsd: budget.limitUsd,
    onBreach: budget.onBreach,
    timezone: budget.timezone,
    externalId: budget.externalId,
    metadata: budget.metadata,
    spentUsd: budget.spentUsd,
    currentPeriodStartedAt: budget.currentPeriodStartedAt,
    resetsAt: budget.resetsAt,
    lastResetAt: budget.lastResetAt,
    cycleAnchorAt: budget.cycleAnchorAt,
    archivedAt: budget.archivedAt,
    createdAt: budget.createdAt,
    updatedAt: budget.updatedAt,
    createdById: budget.createdById,
    managedByVirtualKeyId: budget.managedByVirtualKeyId,
  };
}

// The inline scopeId discriminator for a scope. Post-ADR-021 collapse this
// is the only stored representation of the target; the typed FK columns it
// used to mirror are gone.
function scopeIdForScope(scope: BudgetScope): string {
  switch (scope.kind) {
    case "ORGANIZATION":
      return scope.organizationId;
    case "TEAM":
      return scope.teamId;
    case "PROJECT":
      return scope.projectId;
    case "VIRTUAL_KEY":
      return scope.virtualKeyId;
    case "PRINCIPAL":
      return scope.principalUserId;
    case "GROUP":
      return scope.groupId;
    case "ATTRIBUTED_USER":
      // The stored target is the ANCHOR the template applies to.
      return scope.anchorVirtualKeyId ?? scope.anchorProjectId ?? "";
  }
}

function resolveProjectFromScope(scope: BudgetScope): string | null {
  return scope.kind === "PROJECT" ? scope.projectId : null;
}

// Builds a blockedBy line for a breached budget. effectiveSpent is the
// CH-rollup figure, authoritative post-cutover; b.spentUsd (legacy Prisma
// column) stopped being maintained at the ledger cutover, so reading it
// here would report stale numbers even though the BLOCK decision is
// correct. Must match what scopes[] reports, since UI/errors show it to the user.
function lineFor(
  b: GatewayBudget,
  effectiveSpent: Prisma.Decimal,
): BudgetCheckResult["blockedBy"][number] {
  return {
    budgetId: b.id,
    scope: b.scopeType.toLowerCase(),
    scopeId: b.scopeId,
    window: b.window.toLowerCase(),
    limitUsd: b.limitUsd.toString(),
    spentUsd: effectiveSpent.toFixed(6),
  };
}

function percentUsed(spent: Prisma.Decimal, limit: Prisma.Decimal): number {
  if (limit.isZero()) return 100;
  return Number(spent.div(limit).times(100).toDecimalPlaces(2));
}
