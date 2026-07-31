/**
 * Business logic for GatewayBudget CRUD + the pre-request projective check
 * called from the Go gateway.
 *
 * Scope invariants:
 *   - Every budget row belongs to exactly one organization.
 *   - `scopeType` + `scopeId` identifies the logical target (ADR-021): the
 *     single inline source of truth, with no typed FK columns mirroring it.
 */

import { createLogger } from "@langwatch/observability";
import type {
  GatewayBudget,
  GatewayBudgetWindow,
  PrismaClient,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { GatewayAuditAdapter } from "./auditLog.repository";
import { serializeRowForAudit } from "./auditSerializer";
import type { GatewayBudgetClickHouseRepository } from "./budget.clickhouse.repository";
import {
  attributedUserBucketScopeId,
  bucketScopeIdFor,
  budgetAppliesToProvider,
  resolveApplicableBudgets,
} from "./budgetResolution.service";
import {
  type BudgetScopeReach,
  resolveBudgetScopeReach,
} from "./budgetScopeReach";
import { nextResetAt, shouldResetBudget } from "./budgetWindow";
import { ChangeEventRepository } from "./changeEvent.repository";
import {
  GatewayBudgetNotFoundError,
  GatewayGroupBudgetUnsupportedError,
  GatewayScopeOrgMismatchError,
  VirtualKeyNotFoundError,
} from "./errors";

const logger = createLogger("langwatch:gateway:budget-service");

export type BudgetListWithHealth = {
  budgets: GatewayBudget[];
  /**
   * False when spend could not be totalled. Consumers must say so rather
   * than render the untotalled figure as if it were real spend.
   */
  spendAvailable: boolean;
  scopeReach: Map<string, BudgetScopeReach>;
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
  | { kind: "ATTRIBUTED_USER"; anchorVirtualKeyId?: string; anchorProjectId?: string };

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
  actorUserId: string;
};

export type ArchiveBudgetInput = {
  id: string;
  organizationId: string;
  actorUserId: string;
};

export type BudgetScopeTarget =
  | {
      kind: "ORGANIZATION";
      id: string;
      name: string;
      secondary: string | null;
    }
  | { kind: "TEAM"; id: string; name: string; secondary: string | null }
  | { kind: "PROJECT"; id: string; name: string; secondary: string | null }
  | {
      kind: "VIRTUAL_KEY";
      id: string;
      name: string;
      secondary: string | null;
      projectSlug: string | null;
    }
  | { kind: "PRINCIPAL"; id: string; name: string; secondary: string | null }
  | {
      kind: "ATTRIBUTED_USER";
      id: string;
      name: string;
      secondary: string | null;
      /** Whether the template anchors a virtual key or a project. */
      anchorKind: "virtual_key" | "project";
    }
  | {
      kind: "GROUP";
      id: string;
      name: string;
      secondary: string | null;
      /** Members the per-member allowance currently applies to. */
      memberCount: number;
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
  budget: GatewayBudget;
  scopeTarget: BudgetScopeTarget;
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
   * The provider this request would dispatch to, when the caller knows it.
   * Given it, provider-filtered budgets are consulted; without it only
   * unfiltered budgets are, so a provider filter can never block a request
   * that was never going to that provider.
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

export class GatewayBudgetService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly changeEvents = new ChangeEventRepository(prisma),
    private readonly auditLog = new GatewayAuditAdapter(prisma),
    private readonly chRepo?: GatewayBudgetClickHouseRepository,
  ) {}

  static create(
    prisma: PrismaClient,
    chRepo?: GatewayBudgetClickHouseRepository,
  ): GatewayBudgetService {
    return new GatewayBudgetService(
      prisma,
      new ChangeEventRepository(prisma),
      new GatewayAuditAdapter(prisma),
      chRepo,
    );
  }

  async list(organizationId: string): Promise<GatewayBudget[]> {
    const budgets = await this.prisma.gatewayBudget.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: [{ scopeType: "asc" }, { createdAt: "desc" }],
    });
    return await this.applyClickHouseSpend(budgets, organizationId);
  }

  async listForProject(projectId: string): Promise<GatewayBudget[]> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { team: true },
    });
    if (!project) return [];
    const budgets = await this.prisma.gatewayBudget.findMany({
      where: {
        organizationId: project.team.organizationId,
        archivedAt: null,
        OR: [
          { scopeType: "ORGANIZATION", scopeId: project.team.organizationId },
          { scopeType: "TEAM", scopeId: project.teamId },
          { scopeType: "PROJECT", scopeId: project.id },
        ],
      },
      orderBy: [{ scopeType: "asc" }, { createdAt: "desc" }],
    });
    return await this.applyClickHouseSpend(
      budgets,
      project.team.organizationId,
    );
  }

  /**
   * Decorate budgets with their current-period CH ledger spend, so the
   * /gateway/budgets list view shows real spend instead of the legacy
   * (now stale post-cutover) `GatewayBudget.spentUsd` PG column. Falls
   * back to the PG column for deploys without CH wired (mirrors the
   * fallback in `check()`).
   *
   * The CH ledger is keyed by TenantId = the project where the trace
   * landed. ORG/TEAM/PRINCIPAL-scoped budgets accumulate rows across
   * MULTIPLE projects, so we sum across every project in the org via
   * `getSpendForBudgetsAcrossTenants`.
   */
  private async applyClickHouseSpend(
    budgets: GatewayBudget[],
    organizationId: string,
  ): Promise<GatewayBudget[]> {
    const { budgets: decorated } = await this.applyClickHouseSpendWithHealth(
      budgets,
      organizationId,
    );
    return decorated;
  }

  /**
   * As applyClickHouseSpend, but also reports whether the returned spend
   * figures came from the ledger at all.
   *
   * `GatewayBudget.spentUsd` in Postgres has had no writer since the ledger
   * cutover, so falling back to it renders a confident `$0.00 / $X, 0%` on
   * a budget that is in reality not being totalled and not being enforced.
   * Callers must surface `spendAvailable: false` rather than show that zero
   * as a spend figure.
   */
  private async applyClickHouseSpendWithHealth(
    budgets: GatewayBudget[],
    organizationId: string,
  ): Promise<{ budgets: GatewayBudget[]; spendAvailable: boolean }> {
    if (budgets.length === 0) return { budgets, spendAvailable: true };
    if (!this.chRepo) return { budgets, spendAvailable: false };

    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId }, archivedAt: null },
      select: { id: true },
    });
    // No project means nothing has ever been able to emit a ledger row, so
    // zero is the true total rather than a missing one.
    if (projects.length === 0) return { budgets, spendAvailable: true };

    const tenantIds = projects.map((p) => p.id);
    let spends;
    try {
      spends = await this.chRepo.getSpendForBudgetsAcrossTenants(
        tenantIds,
        budgets,
      );
    } catch (error) {
      logger.error(
        { organizationId, budgetCount: budgets.length, error },
        "failed to read gateway budget spend totals",
      );
      return { budgets, spendAvailable: false };
    }

    const spendByBudget = new Map(spends.map((s) => [s.budgetId, s.spentUsd]));
    return {
      spendAvailable: true,
      budgets: budgets.map((b) => {
        const ch = spendByBudget.get(b.id);
        if (ch === undefined) return b;
        return { ...b, spentUsd: new Prisma.Decimal(ch) };
      }),
    };
  }

  /**
   * Budgets for the organization's list view, with the two health signals
   * the view cannot render honestly without: whether spend could be totalled
   * at all, and which budgets no active key can ever spend against.
   */
  async listWithHealth(organizationId: string): Promise<BudgetListWithHealth> {
    const rows = await this.prisma.gatewayBudget.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: [{ scopeType: "asc" }, { createdAt: "desc" }],
    });
    return await this.decorateWithHealth(rows, organizationId);
  }

  /** As listWithHealth, for the budgets that apply to one project. */
  async listForProjectWithHealth(
    projectId: string,
  ): Promise<BudgetListWithHealth> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { team: true },
    });
    if (!project) {
      return { budgets: [], spendAvailable: true, scopeReach: new Map() };
    }
    const rows = await this.prisma.gatewayBudget.findMany({
      where: {
        organizationId: project.team.organizationId,
        archivedAt: null,
        OR: [
          { scopeType: "ORGANIZATION", scopeId: project.team.organizationId },
          { scopeType: "TEAM", scopeId: project.teamId },
          { scopeType: "PROJECT", scopeId: project.id },
        ],
      },
      orderBy: [{ scopeType: "asc" }, { createdAt: "desc" }],
    });
    return await this.decorateWithHealth(rows, project.team.organizationId);
  }

  private async decorateWithHealth(
    rows: GatewayBudget[],
    organizationId: string,
  ): Promise<BudgetListWithHealth> {
    const [{ budgets, spendAvailable }, scopeReach] = await Promise.all([
      this.applyClickHouseSpendWithHealth(rows, organizationId),
      resolveBudgetScopeReach(this.prisma, organizationId, rows),
    ]);
    return { budgets, spendAvailable, scopeReach };
  }

  async get(id: string, organizationId: string): Promise<GatewayBudget | null> {
    const budget = await this.prisma.gatewayBudget.findFirst({
      where: { id, organizationId },
    });
    if (!budget) return null;
    const [decorated] = await this.applyClickHouseSpend(
      [budget],
      organizationId,
    );
    return decorated ?? budget;
  }

  /**
   * Returns the budget plus resolved scope-target label (human-friendly
   * name for the scope FK) + the last 20 ledger entries for the detail
   * page. Keeps the target lookup in one round-trip per scope kind so
   * the detail page doesn't need to chain queries in the UI.
   */
  async getDetail(
    id: string,
    organizationId: string,
  ): Promise<BudgetDetail | null> {
    const row = await this.prisma.gatewayBudget.findFirst({
      where: { id, organizationId },
    });
    if (!row) return null;
    const { budgets, spendAvailable, scopeReach } =
      await this.decorateWithHealth([row], organizationId);
    const budget = budgets[0] ?? row;

    const scopeTarget = await this.resolveScopeTarget(budget);

    // Recent ledger entries come from ClickHouse
    // (gateway_budget_ledger_events). The CH events table doesn't carry
    // the VK name/displayPrefix fields, so we resolve those via a
    // single Prisma round-trip on the distinct VK ids in the slice.
    let recentLedger: BudgetDetail["recentLedger"] = [];
    if (this.chRepo) {
      const tenantId = await this.resolveTenantIdForBudget(budget);
      const events = tenantId
        ? await this.chRepo.recentEventsForBudget(tenantId, budget.id, 20)
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
   * Resolve the projectId that the ClickHouse client should be scoped to
   * when reading ledger events for `budget`. Tenant resolution mirrors the
   * trace-fold reactor's logic: the events table is sharded on
   * `TenantId = projectId` so only org/team/project/VK-scoped budgets
   * have a meaningful tenant; principal-scoped budgets cross projects
   * and we return null (no ledger lookup).
   */
  private async resolveTenantIdForBudget(
    budget: GatewayBudget,
  ): Promise<string | null> {
    switch (budget.scopeType) {
      case "PROJECT":
        return budget.scopeId;
      case "VIRTUAL_KEY": {
        // Post-collapse: VK no longer has a single projectId. Pick the
        // first PROJECT-scope row; org-scoped VKs without a project
        // scope have no single tenant (returns null → empty panel,
        // same shape as ORG/TEAM-scoped budgets).
        const scope = await this.prisma.virtualKeyScope.findFirst({
          where: { virtualKeyId: budget.scopeId, scopeType: "PROJECT" },
          select: { scopeId: true },
          orderBy: { createdAt: "asc" },
        });
        return scope?.scopeId ?? null;
      }
      case "ORGANIZATION":
      case "TEAM":
        // Org/team budgets span multiple projects → no single CH tenant
        // to query. Recent-ledger panel is empty for these scopes until a
        // future iteration teaches the repo to fan out across projects.
        return null;
      case "PRINCIPAL":
      case "GROUP":
        // Principal and per-member group buckets span every project
        // the person works in, so there is no single CH tenant to read
        // their recent ledger from.
        return null;
      case "ATTRIBUTED_USER":
        // Per-user buckets accrue wherever the anchor's traffic lands;
        // no single tenant, same as GROUP.
        return null;
    }
  }

  private async resolveScopeTarget(
    budget: GatewayBudget,
  ): Promise<BudgetScopeTarget> {
    switch (budget.scopeType) {
      case "ORGANIZATION": {
        const org = await this.prisma.organization.findUnique({
          where: { id: budget.scopeId },
          select: { name: true, slug: true },
        });
        return {
          kind: "ORGANIZATION",
          id: budget.scopeId,
          name: org?.name ?? budget.scopeId,
          secondary: org?.slug ?? null,
        };
      }
      case "TEAM": {
        const team = await this.prisma.team.findUnique({
          where: { id: budget.scopeId },
          select: { name: true, slug: true },
        });
        return {
          kind: "TEAM",
          id: budget.scopeId,
          name: team?.name ?? budget.scopeId,
          secondary: team?.slug ?? null,
        };
      }
      case "PROJECT": {
        const project = await this.prisma.project.findUnique({
          where: { id: budget.scopeId },
          select: { name: true, slug: true },
        });
        return {
          kind: "PROJECT",
          id: budget.scopeId,
          name: project?.name ?? budget.scopeId,
          secondary: project?.slug ?? null,
        };
      }
      case "VIRTUAL_KEY": {
        const vk = await this.prisma.virtualKey.findUnique({
          where: { id: budget.scopeId },
          select: { name: true, displayPrefix: true },
        });
        const projectScope = await this.prisma.virtualKeyScope.findFirst({
          where: { virtualKeyId: budget.scopeId, scopeType: "PROJECT" },
          select: { scopeId: true },
          orderBy: { createdAt: "asc" },
        });
        const project = projectScope
          ? await this.prisma.project.findUnique({
              where: { id: projectScope.scopeId },
              select: { slug: true },
            })
          : null;
        return {
          kind: "VIRTUAL_KEY",
          id: budget.scopeId,
          name: vk?.name ?? budget.scopeId,
          secondary: vk?.displayPrefix ? `${vk.displayPrefix}…` : null,
          projectSlug: project?.slug ?? null,
        };
      }
      case "PRINCIPAL": {
        const user = await this.prisma.user.findUnique({
          where: { id: budget.scopeId },
          select: { name: true, email: true },
        });
        return {
          kind: "PRINCIPAL",
          id: budget.scopeId,
          name: user?.name ?? user?.email ?? budget.scopeId,
          secondary: user?.email ?? null,
        };
      }
      case "GROUP": {
        const group = await this.prisma.group.findUnique({
          where: { id: budget.scopeId },
          select: {
            name: true,
            slug: true,
            _count: { select: { members: true } },
          },
        });
        return {
          kind: "GROUP",
          id: budget.scopeId,
          name: group?.name ?? budget.scopeId,
          secondary: group?.slug ?? null,
          memberCount: group?._count.members ?? 0,
        };
      }
      case "ATTRIBUTED_USER": {
        // The anchor is a virtual key or a project; resolve whichever the
        // id turns out to be so the UI can render "every end user on X".
        const vk = await this.prisma.virtualKey.findUnique({
          where: { id: budget.scopeId },
          select: { name: true, displayPrefix: true },
        });
        if (vk) {
          return {
            kind: "ATTRIBUTED_USER",
            id: budget.scopeId,
            name: vk.name,
            secondary: vk.displayPrefix,
            anchorKind: "virtual_key",
          };
        }
        const project = await this.prisma.project.findUnique({
          where: { id: budget.scopeId },
          select: { name: true, slug: true },
        });
        return {
          kind: "ATTRIBUTED_USER",
          id: budget.scopeId,
          name: project?.name ?? budget.scopeId,
          secondary: project?.slug ?? null,
          anchorKind: "project",
        };
      }
    }
  }

  async create(input: CreateBudgetInput): Promise<GatewayBudget> {
    // Cross-org guard for PRINCIPAL budgets: the named user must be a
    // member of the budget's organization. Without this check an admin
    // in org A could create a PRINCIPAL budget for any userId — the FK
    // to User would still pass, but the budget would never match the
    // user's traffic (PRINCIPAL spans only their org's VKs), so the
    // budget would be a silent no-op. Reject up-front with a helpful
    // BAD_REQUEST instead. Spec:
    // specs/ai-gateway/budgets-principal-cascade.feature.
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

    // Cross-org guard for TEAM / PROJECT budgets: the scoped team/project must
    // belong to the budget's organization. organizationId is derived from the
    // authenticated caller's project, but the scope id is request-supplied — a
    // caller could otherwise create a budget targeting another tenant's team or
    // project. The FK to Team/Project alone does not prevent this since it is
    // org-agnostic. Mirrors the PRINCIPAL guard above.
    if (input.scope.kind === "TEAM") {
      const team = await this.prisma.team.findFirst({
        where: { id: input.scope.teamId, organizationId: input.organizationId },
        select: { id: true },
      });
      if (!team) {
        throw new GatewayScopeOrgMismatchError("team");
      }
    }
    if (input.scope.kind === "PROJECT") {
      const proj = await this.prisma.project.findFirst({
        where: {
          id: input.scope.projectId,
          team: { organizationId: input.organizationId },
        },
        select: { id: true },
      });
      if (!proj) {
        throw new GatewayScopeOrgMismatchError("project");
      }
    }
    // Cross-org + product-managed guard for VIRTUAL_KEY budgets. The scope id
    // is request-supplied, so without the org check a caller could budget
    // another tenant's key; and a product-managed VK (purpose != USER — the
    // Langy VK) is not the customer's to constrain: a $0.01 BLOCK budget on it
    // would deny every Langy turn, the same "customer breaks a product-managed
    // credential" class the by-id mutation guards already close. Not-found
    // rather than forbidden, so the response never confirms the id exists.
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
      // A GROUP budget is one enforcement bucket per member, and per-member
      // buckets only exist on the ClickHouse spend path. Without it,
      // `check()` falls back to the single PG `spentUsd` figure per budget
      // row, which would enforce each member against the whole
      // group's combined spend: a different control than the one the
      // admin asked for. Refuse rather than create a cap that cannot mean
      // what it says. Detection matches `check()`'s own CH-vs-PG pick:
      // the presence of the ClickHouse repo this service was built with.
      // Spec: specs/ai-gateway/gateway-budget-targeting.feature.
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
      if (projectAnchor) {
        const proj = await this.prisma.project.findFirst({
          where: {
            id: projectAnchor,
            team: { organizationId: input.organizationId },
          },
          select: { id: true },
        });
        if (!proj) {
          throw new GatewayScopeOrgMismatchError("project");
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

    const resetsAt = nextResetAt(input.window);
    const projectId = resolveProjectFromScope(input.scope);

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.gatewayBudget.create({
        data: {
          organizationId: input.organizationId,
          scopeType: scopeKindToEnum(input.scope.kind),
          scopeId: scopeIdForScope(input.scope),
          name: input.name,
          description: input.description ?? null,
          window: input.window,
          limitUsd: new Prisma.Decimal(input.limitUsd.toString()),
          onBreach: input.onBreach ?? "BLOCK",
          timezone: input.timezone ?? null,
          providerKey: input.providerKey ?? null,
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
    });

    return created;
  }

  async update(input: UpdateBudgetInput): Promise<GatewayBudget> {
    const existing = await this.get(input.id, input.organizationId);
    if (!existing) throw new GatewayBudgetNotFoundError();
    const before = serializeRowForAudit(existing);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.gatewayBudget.update({
        where: { id: input.id },
        data: {
          name: input.name ?? existing.name,
          description:
            input.description === undefined
              ? existing.description
              : input.description,
          limitUsd:
            input.limitUsd !== undefined
              ? new Prisma.Decimal(input.limitUsd.toString())
              : existing.limitUsd,
          onBreach: input.onBreach ?? existing.onBreach,
          timezone:
            input.timezone === undefined ? existing.timezone : input.timezone,
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
    });
  }

  async archive(input: ArchiveBudgetInput): Promise<GatewayBudget> {
    const existing = await this.get(input.id, input.organizationId);
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
   * Move a budget's period boundary to now. NEVER mutates recorded spend:
   * the ledger and every emitted billing event are immutable, so
   * reconciliation is unaffected by resets; the boundary move alone is
   * what makes the current-period figure start over. On calendar windows
   * this truncates the running period (the next boundary stays calendar);
   * on MANUAL windows the new period stays open until the next reset.
   * With `endUserId`, only that end-user's bucket boundary moves (a
   * per-bucket row, the template's own boundary stays), which is the
   * single-user reset an operator does mid-cycle.
   */
  async reset(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
    endUserId?: string | null;
    reason?: string | null;
  }): Promise<GatewayBudget> {
    const existing = await this.get(input.id, input.organizationId);
    if (!existing) throw new GatewayBudgetNotFoundError();
    const before = serializeRowForAudit(existing);
    const now = new Date();

    if (input.endUserId) {
      if (existing.scopeType !== "ATTRIBUTED_USER") {
        throw new GatewayScopeOrgMismatchError("attributed-user budget");
      }
      const bucketScopeId = bucketScopeIdFor(
        existing,
        attributedUserBucketScopeId(existing.scopeId, input.endUserId),
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
            organizationId: input.organizationId,
            budgetId: existing.id,
            bucketScopeId,
            periodStartedAt: now,
          },
          update: { periodStartedAt: now },
        });
        await this.auditLog.append(
          {
            organizationId: input.organizationId,
            actorUserId: input.actorUserId,
            action: "gateway.budget.reset",
            targetKind: "budget",
            targetId: existing.id,
            before,
            after: {
              row: serializeRowForAudit(existing),
              resetBucketScopeId: bucketScopeId,
              resetReason: input.reason ?? null,
            },
          },
          tx,
        );
      });
      return existing;
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.gatewayBudget.update({
        where: { id: input.id },
        data: {
          currentPeriodStartedAt: now,
          lastResetAt: now,
          resetsAt: nextResetAt(existing.window, now),
          // The current-period figure the bundle reads; the period just
          // restarted, so it is zero by definition. Ledger rows untouched.
          spentUsd: new Prisma.Decimal(0),
        },
      });
      // Anchor-wide reset clears any per-bucket boundaries: the whole
      // template starts a fresh period, including buckets that had their
      // own single-user resets inside the old one.
      await tx.gatewayBudgetBucketBoundary.deleteMany({
        where: { budgetId: existing.id },
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
  async check(input: BudgetCheckInput): Promise<BudgetCheckResult> {
    const projected = new Prisma.Decimal(input.projectedCostUsd.toString());

    // Same resolver the bundle and the trace fold use, so what enforces
    // here is exactly what the key was told applies to it.
    const resolved = (
      await resolveApplicableBudgets(this.prisma, {
        organizationId: input.organizationId,
        teamId: input.teamId,
        projectId: input.projectId,
        virtualKeyId: input.virtualKeyId,
        principalUserId: input.principalUserId,
      })
    ).filter((r) => budgetAppliesToProvider(r.budget, input.providerKey));
    const applicable = resolved.map((r) => r.budget);

    // Prefer ClickHouse spend (trace-fold ledger) when the repo is wired,
    // fall back to the PG `spentUsd` column for deploys without CH. The
    // CH rollup is keyed by (budget, current period) so it self-resets at
    // period boundaries — no `shouldResetBudget` branch needed on that
    // path. The PG path still needs it because the column accumulates
    // across periods until a writer resets it.
    //
    // Tenant fan-out: ORG/TEAM/PRINCIPAL-scoped budgets accumulate ledger
    // rows under whichever project emitted the trace, so the CH query
    // must consider every project in the org — not just the resolved
    // trace project. Mirrors the materialiser's `loadCurrentSpend`.
    const chSpendByBudgetId = this.chRepo
      ? await (async () => {
          const orgProjects = await this.prisma.project.findMany({
            where: { team: { organizationId: input.organizationId } },
            select: { id: true },
          });
          const tenantIds = orgProjects.map((p) => p.id);
          if (tenantIds.length === 0) return new Map<string, string>();
          const spends = await this.chRepo!.getSpendForBudgetsAcrossTenants(
            tenantIds,
            resolved.map((r) => ({
              budgetId: r.budget.id,
              scope: r.budget.scopeType,
              scopeId: r.bucketScopeId,
              window: r.budget.window,
              match: "exact" as const,
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
        : shouldResetBudget(budget.window, budget.resetsAt, now)
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
      blockedBy.length > 0
        ? "hard_block"
        : warnings.length > 0
          ? "soft_warn"
          : "allow";

    return { decision, warnings, blockReason, blockedBy, scopes };
  }
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

function scopeKindToEnum(
  kind: BudgetScope["kind"],
):
  | "ORGANIZATION"
  | "TEAM"
  | "PROJECT"
  | "VIRTUAL_KEY"
  | "PRINCIPAL"
  | "GROUP"
  | "ATTRIBUTED_USER" {
  return kind;
}

function resolveProjectFromScope(scope: BudgetScope): string | null {
  return scope.kind === "PROJECT" ? scope.projectId : null;
}

// Builds a blockedBy line for a breached budget. `effectiveSpent` is the
// CH-rollup-derived figure — the authoritative post-cutover spend.
// `b.spentUsd` (the legacy Prisma column) stopped being maintained when
// the outbox/debit path was replaced by the trace-fold pipeline, so
// reading it here would report stale numbers even though the BLOCK
// decision itself is correct. UI + error messages downstream show
// this spent_usd to the user, so it must match what `scopes[]` reports.
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
