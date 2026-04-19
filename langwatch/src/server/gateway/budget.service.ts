/**
 * Business logic for GatewayBudget CRUD + the pre-request projective check
 * called from the Go gateway.
 *
 * Scope invariants:
 *   - Every budget row belongs to exactly one organization.
 *   - `scopeType` + `scopeId` identifies the logical target.
 *   - Exactly one typed FK column (`organizationScopedId`,
 *     `teamScopedId`, `projectScopedId`, `virtualKeyScopedId`,
 *     `principalUserId`) is non-null, and it matches `scopeType`.
 *
 * The DB CHECK constraint `GatewayBudget_scope_check` enforces this at
 * write-time; the service layer enforces it up front to produce friendly
 * tRPC errors instead of a PG error.
 */
import type {
  GatewayBudget,
  GatewayBudgetWindow,
  PrismaClient,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";

import { GatewayAuditLogRepository } from "./auditLog.repository";
import { serializeRowForAudit } from "./auditSerializer";
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
  teamId: string;
  projectId: string;
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
    private readonly auditLog = new GatewayAuditLogRepository(prisma),
  ) {}

  static create(prisma: PrismaClient): GatewayBudgetService {
    return new GatewayBudgetService(prisma);
  }

  async list(organizationId: string): Promise<GatewayBudget[]> {
    return this.prisma.gatewayBudget.findMany({
      where: { organizationId, archivedAt: null },
      orderBy: [{ scopeType: "asc" }, { createdAt: "desc" }],
    });
  }

  async listForProject(projectId: string): Promise<GatewayBudget[]> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { team: true },
    });
    if (!project) return [];
    return this.prisma.gatewayBudget.findMany({
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
  }

  async get(id: string, organizationId: string): Promise<GatewayBudget | null> {
    return this.prisma.gatewayBudget.findFirst({
      where: { id, organizationId },
    });
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

    const [scopeTarget, recentLedger] = await Promise.all([
      this.resolveScopeTarget(budget),
      this.prisma.gatewayBudgetLedger.findMany({
        where: { budgetId: budget.id },
        orderBy: { occurredAt: "desc" },
        take: 20,
        select: {
          id: true,
          virtualKeyId: true,
          amountUsd: true,
          model: true,
          status: true,
          occurredAt: true,
          virtualKey: { select: { name: true, displayPrefix: true } },
        },
      }),
    ]);

    return { budget, scopeTarget, recentLedger };
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
          select: {
            name: true,
            displayPrefix: true,
            project: { select: { slug: true } },
          },
        });
        return {
          kind: "VIRTUAL_KEY",
          id: budget.scopeId,
          name: vk?.name ?? budget.scopeId,
          secondary: vk?.displayPrefix ? `${vk.displayPrefix}…` : null,
          projectSlug: vk?.project?.slug ?? null,
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
    const resetsAt = nextResetAt(input.window);
    const scopeCols = scopeToColumns(input.scope);
    const projectId = resolveProjectFromScope(input.scope);

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.gatewayBudget.create({
        data: {
          organizationId: input.organizationId,
          scopeType: scopeKindToEnum(input.scope.kind),
          scopeId: scopeCols.scopeId,
          organizationScopedId: scopeCols.organizationScopedId,
          teamScopedId: scopeCols.teamScopedId,
          projectScopedId: scopeCols.projectScopedId,
          virtualKeyScopedId: scopeCols.virtualKeyScopedId,
          principalUserId: scopeCols.principalUserId,
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
          action: "BUDGET_CREATED",
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
          action: "BUDGET_UPDATED",
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
          action: "BUDGET_DELETED",
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

    const applicable = await this.prisma.gatewayBudget.findMany({
      where: {
        organizationId: input.organizationId,
        archivedAt: null,
        OR: [
          { scopeType: "ORGANIZATION", scopeId: input.organizationId },
          { scopeType: "TEAM", scopeId: input.teamId },
          { scopeType: "PROJECT", scopeId: input.projectId },
          { scopeType: "VIRTUAL_KEY", scopeId: input.virtualKeyId },
          input.principalUserId
            ? { scopeType: "PRINCIPAL", scopeId: input.principalUserId }
            : { id: "__never__" },
        ],
      },
    });

    const now = new Date();
    const warnings: BudgetCheckResult["warnings"] = [];
    const blockedBy: BudgetCheckResult["blockedBy"] = [];
    const scopes: BudgetCheckResult["scopes"] = [];
    let blockReason: string | null = null;

    for (const budget of applicable) {
      const effectiveSpent = shouldResetBudget(
        budget.window,
        budget.resetsAt,
        now,
      )
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
          blockedBy.push(lineFor(budget));
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

function scopeToColumns(scope: BudgetScope): {
  scopeId: string;
  organizationScopedId: string | null;
  teamScopedId: string | null;
  projectScopedId: string | null;
  virtualKeyScopedId: string | null;
  principalUserId: string | null;
} {
  switch (scope.kind) {
    case "ORGANIZATION":
      return {
        scopeId: scope.organizationId,
        organizationScopedId: scope.organizationId,
        teamScopedId: null,
        projectScopedId: null,
        virtualKeyScopedId: null,
        principalUserId: null,
      };
    case "TEAM":
      return {
        scopeId: scope.teamId,
        organizationScopedId: null,
        teamScopedId: scope.teamId,
        projectScopedId: null,
        virtualKeyScopedId: null,
        principalUserId: null,
      };
    case "PROJECT":
      return {
        scopeId: scope.projectId,
        organizationScopedId: null,
        teamScopedId: null,
        projectScopedId: scope.projectId,
        virtualKeyScopedId: null,
        principalUserId: null,
      };
    case "VIRTUAL_KEY":
      return {
        scopeId: scope.virtualKeyId,
        organizationScopedId: null,
        teamScopedId: null,
        projectScopedId: null,
        virtualKeyScopedId: scope.virtualKeyId,
        principalUserId: null,
      };
    case "PRINCIPAL":
      return {
        scopeId: scope.principalUserId,
        organizationScopedId: null,
        teamScopedId: null,
        projectScopedId: null,
        virtualKeyScopedId: null,
        principalUserId: scope.principalUserId,
      };
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

function lineFor(b: GatewayBudget): BudgetCheckResult["blockedBy"][number] {
  return {
    budgetId: b.id,
    scope: b.scopeType.toLowerCase(),
    scopeId: b.scopeId,
    window: b.window.toLowerCase(),
    limitUsd: b.limitUsd.toString(),
    spentUsd: b.spentUsd.toString(),
  };
}

function percentUsed(spent: Prisma.Decimal, limit: Prisma.Decimal): number {
  if (limit.isZero()) return 100;
  return Number(spent.div(limit).times(100).toDecimalPlaces(2));
}
