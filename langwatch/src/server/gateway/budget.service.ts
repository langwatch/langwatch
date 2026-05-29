/**
 * Business logic for GatewayBudget CRUD + the pre-request projective check
 * called from the Go gateway.
 *
 * Scope invariants:
 *   - Every budget row belongs to exactly one organization.
 *   - `scopeType` + `scopeId` identifies the logical target (ADR-021): the
 *     single inline source of truth, with no typed FK columns mirroring it.
 */
import type {
  GatewayBudget,
  GatewayBudgetWindow,
  PrismaClient,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import { GatewayAuditAdapter } from "./auditLog.repository";
import { serializeRowForAudit } from "./auditSerializer";
import { GatewayBudgetClickHouseRepository } from "./budget.clickhouse.repository";
import { nextResetAt, shouldResetBudget } from "./budgetWindow";
import { ChangeEventRepository } from "./changeEvent.repository";

export type BudgetScope =
  | { kind: "ORGANIZATION"; organizationId: string }
  | { kind: "TEAM"; teamId: string }
  | { kind: "PROJECT"; projectId: string }
  | { kind: "VIRTUAL_KEY"; virtualKeyId: string }
  | { kind: "PRINCIPAL"; principalUserId: string };

export type CreateBudgetInput = {
  organizationId: string;
  scope: BudgetScope;
  name: string;
  description?: string | null;
  window: GatewayBudgetWindow;
  limitUsd: number | string | Prisma.Decimal;
  onBreach?: "BLOCK" | "WARN";
  timezone?: string | null;
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
  | { kind: "PRINCIPAL"; id: string; name: string; secondary: string | null };

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
    return await this.applyClickHouseSpend(budgets, project.team.organizationId);
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
    if (!this.chRepo || budgets.length === 0) return budgets;
    const projects = await this.prisma.project.findMany({
      where: { team: { organizationId }, archivedAt: null },
      select: { id: true },
    });
    if (projects.length === 0) return budgets;
    const tenantIds = projects.map((p) => p.id);
    const spends = await this.chRepo.getSpendForBudgetsAcrossTenants(
      tenantIds,
      budgets,
    );
    const spendByBudget = new Map(spends.map((s) => [s.budgetId, s.spentUsd]));
    return budgets.map((b) => {
      const ch = spendByBudget.get(b.id);
      if (ch === undefined) return b;
      return { ...b, spentUsd: new Prisma.Decimal(ch) };
    });
  }

  async get(id: string, organizationId: string): Promise<GatewayBudget | null> {
    const budget = await this.prisma.gatewayBudget.findFirst({
      where: { id, organizationId },
    });
    if (!budget) return null;
    const [decorated] = await this.applyClickHouseSpend([budget], organizationId);
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
    const budget = await this.get(id, organizationId);
    if (!budget) return null;

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

    return { budget, scopeTarget, recentLedger };
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
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "principalUserId is not a member of this organization — PRINCIPAL budgets must scope a user inside the budget's org.",
        });
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
    if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
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
    if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
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
   * Pre-request projective check: given `projected_cost_usd` would any
   * applicable scope breach? Does NOT mutate spend — that happens in the
   * post-response debit path (contract §4.5).
   */
  async check(input: BudgetCheckInput): Promise<BudgetCheckResult> {
    const projected = new Prisma.Decimal(input.projectedCostUsd.toString());

    const ors: Prisma.GatewayBudgetWhereInput[] = [
      { scopeType: "ORGANIZATION", scopeId: input.organizationId },
      { scopeType: "VIRTUAL_KEY", scopeId: input.virtualKeyId },
    ];
    if (input.teamId) {
      ors.push({ scopeType: "TEAM", scopeId: input.teamId });
    }
    if (input.projectId) {
      ors.push({ scopeType: "PROJECT", scopeId: input.projectId });
    }
    if (input.principalUserId) {
      ors.push({ scopeType: "PRINCIPAL", scopeId: input.principalUserId });
    }
    const applicable = await this.prisma.gatewayBudget.findMany({
      where: {
        organizationId: input.organizationId,
        archivedAt: null,
        OR: ors,
      },
    });

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
            applicable,
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
  }
}

function scopeKindToEnum(
  kind: BudgetScope["kind"],
):
  | "ORGANIZATION"
  | "TEAM"
  | "PROJECT"
  | "VIRTUAL_KEY"
  | "PRINCIPAL" {
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
