/**
 * tRPC router for gateway budgets.
 *
 * Budgets are always organization-scoped but the resource target is one of
 * ORGANIZATION / TEAM / PROJECT / VIRTUAL_KEY / PRINCIPAL / GROUP. The UI
 * flows pass a scope kind + target id; the server normalises onto
 * `scopeType` and the matching typed FK column.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getApp } from "~/server/app-layer/app";
import {
  GatewayBudgetService,
  type GatewayBudgetWithSeats,
} from "~/server/gateway/budget.service";
import { effectiveBudgetPeriod } from "~/server/gateway/budgetPeriod";
import {
  providerLabelFor,
  resolveProviderLabels,
} from "~/server/gateway/providerLabels";
import {
  resolveScopeTargetsBatch,
  scopeTargetKey,
} from "~/server/gateway/scopeTargets";

import { createTRPCRouter, protectedProcedure } from "../trpc";

const scopeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ORGANIZATION"),
    organizationId: z.string(),
  }),
  z.object({ kind: z.literal("TEAM"), teamId: z.string() }),
  z.object({ kind: z.literal("PROJECT"), projectId: z.string() }),
  z.object({ kind: z.literal("VIRTUAL_KEY"), virtualKeyId: z.string() }),
  z.object({ kind: z.literal("PRINCIPAL"), principalUserId: z.string() }),
  // Per-member group budgets. Creation is service-guarded: it needs
  // the ClickHouse spend path (group_budget_requires_clickhouse otherwise).
  z.object({ kind: z.literal("GROUP"), groupId: z.string() }),
]);

async function requireOrgAccess(
  ctx: { prisma: import("~/generated/prisma/client").PrismaClient },
  organizationId: string,
) {
  const org = await ctx.prisma.organization.findUnique({
    where: { id: organizationId },
  });
  if (!org) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "organization not found",
    });
  }
}

export const gatewayBudgetsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("gatewayBudgets:view")
    .query(async ({ ctx, input }) => {
      await requireOrgAccess(ctx, input.organizationId);
      const service = GatewayBudgetService.create(
        ctx.prisma,
        getApp().gateway.budgets,
      );
      const { budgets, spendAvailable, scopeReach } =
        await service.listWithHealth(input.organizationId);
      const scopeTargets = await resolveScopeTargetsBatch(
        ctx.prisma,
        budgets,
        input.organizationId,
      );
      const providerLabels = await resolveProviderLabels({
        prisma: ctx.prisma,
        budgets,
      });
      return {
        spendAvailable,
        budgets: budgets.map((b) => ({
          ...toDto(b),
          spendAvailable,
          unreachableByAnyKey: scopeReach.get(b.id)?.reachable === false,
          scopeTarget:
            scopeTargets.get(scopeTargetKey(b.scopeType, b.scopeId)) ?? null,
          providerLabel: providerLabelFor(providerLabels, b.providerKey),
        })),
      };
    }),

  listForProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("gatewayBudgets:view")
    .query(async ({ ctx, input }) => {
      const service = GatewayBudgetService.create(
        ctx.prisma,
        getApp().gateway.budgets,
      );
      const { budgets, spendAvailable, scopeReach } =
        await service.listForProjectWithHealth(input.projectId);
      const project = await ctx.prisma.project.findUnique({
        where: { id: input.projectId },
        select: { team: { select: { organizationId: true } } },
      });
      const scopeTargets = await resolveScopeTargetsBatch(
        ctx.prisma,
        budgets,
        project?.team.organizationId ?? null,
      );
      const providerLabels = await resolveProviderLabels({
        prisma: ctx.prisma,
        budgets,
      });
      return {
        spendAvailable,
        budgets: budgets.map((b) => ({
          ...toDto(b),
          spendAvailable,
          unreachableByAnyKey: scopeReach.get(b.id)?.reachable === false,
          scopeTarget:
            scopeTargets.get(scopeTargetKey(b.scopeType, b.scopeId)) ?? null,
          providerLabel: providerLabelFor(providerLabels, b.providerKey),
        })),
      };
    }),

  get: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .permission("gatewayBudgets:view")
    .query(async ({ ctx, input }) => {
      await requireOrgAccess(ctx, input.organizationId);
      const service = GatewayBudgetService.create(
        ctx.prisma,
        getApp().gateway.budgets,
      );
      const detail = await service.getDetail(input.id, input.organizationId);
      if (!detail) {
        throw new TRPCError({ code: "NOT_FOUND", message: "budget not found" });
      }
      const providerLabels = await resolveProviderLabels({
        prisma: ctx.prisma,
        budgets: [detail.budget],
      });
      return {
        ...toDto(detail.budget),
        spendAvailable: detail.spendAvailable,
        unreachableByAnyKey: detail.unreachableByAnyKey,
        scopeTarget: detail.scopeTarget,
        providerLabel: providerLabelFor(
          providerLabels,
          detail.budget.providerKey,
        ),
        recentLedger: detail.recentLedger.map((l) => ({
          id: l.id,
          virtualKeyId: l.virtualKeyId,
          virtualKeyName: l.virtualKey?.name ?? l.virtualKeyId,
          virtualKeyPrefix: l.virtualKey?.displayPrefix ?? "",
          amountUsd: l.amountUsd.toString(),
          model: l.model,
          status: l.status,
          occurredAt: l.occurredAt.toISOString(),
        })),
      };
    }),

  /**
   * The groups a budget can target, for whoever may create budgets.
   * `group.listAll` exposes role-binding maps and demands
   * organization:manage; a budget creator only needs names and sizes, so
   * this stays gated by the same permission as the create it serves.
   */
  groupTargets: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .permission("gatewayBudgets:create")
    .query(async ({ ctx, input }) => {
      return await GatewayBudgetService.create(ctx.prisma).groupTargets(
        input.organizationId,
      );
    }),

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        scope: scopeSchema,
        name: z.string().min(1).max(128),
        description: z.string().optional(),
        window: z.enum([
          "MINUTE",
          "HOUR",
          "DAY",
          "WEEK",
          "MONTH",
          "TOTAL",
          "MANUAL",
        ]),
        limitUsd: z.number().positive().or(z.string()),
        onBreach: z.enum(["BLOCK", "WARN"]).optional(),
        timezone: z.string().nullable().optional(),
        // ModelProvider row id. Null / absent = the budget counts every
        // provider; set = it counts and constrains only that provider.
        providerKey: z.string().nullable().optional(),
        // Phases a cyclic window off this instant instead of the calendar.
        // Absent keeps the calendar alignment. Rejected on TOTAL and
        // MANUAL, which do not cycle.
        //
        // A Date, or an ISO string carrying its offset, and nothing looser:
        // the same instant the REST surface demands. An offsetless string
        // would be read in whichever zone the server process happens to run
        // in, so the anchor a customer set would land on a different instant
        // per deployment.
        cycleAnchorAt: z
          .union([
            z.date(),
            z
              .string()
              .datetime({ offset: true })
              .transform((iso) => new Date(iso)),
          ])
          .nullable()
          .optional(),
        // Keeps a team / project / group budget no active key can reach,
        // which is otherwise refused. Provisioning ahead of the keys that
        // will use it is legitimate, so the guardrail is not a prohibition.
        allowUnreachable: z.boolean().optional(),
      }),
    )
    .permission("gatewayBudgets:create")
    .mutation(async ({ ctx, input }) => {
      const service = GatewayBudgetService.create(
        ctx.prisma,
        getApp().gateway.budgets,
      );
      const row = await service.create({
        organizationId: input.organizationId,
        scope: input.scope,
        name: input.name,
        description: input.description ?? null,
        window: input.window,
        limitUsd: input.limitUsd,
        onBreach: input.onBreach,
        timezone: input.timezone ?? null,
        providerKey: input.providerKey ?? null,
        cycleAnchorAt: input.cycleAnchorAt ?? null,
        allowUnreachable: input.allowUnreachable,
        actorUserId: ctx.session.user.id,
      });
      return toDto(row);
    }),

  update: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        id: z.string(),
        name: z.string().min(1).max(128).optional(),
        description: z.string().nullable().optional(),
        limitUsd: z.number().positive().or(z.string()).optional(),
        onBreach: z.enum(["BLOCK", "WARN"]).optional(),
        timezone: z.string().nullable().optional(),
      }),
    )
    .permission("gatewayBudgets:update")
    .mutation(async ({ ctx, input }) => {
      const service = GatewayBudgetService.create(
        ctx.prisma,
        getApp().gateway.budgets,
      );
      const row = await service.update({
        ...input,
        actorUserId: ctx.session.user.id,
      });
      return toDto(row);
    }),

  archive: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .permission("gatewayBudgets:delete")
    .mutation(async ({ ctx, input }) => {
      const service = GatewayBudgetService.create(
        ctx.prisma,
        getApp().gateway.budgets,
      );
      const row = await service.archive({
        ...input,
        actorUserId: ctx.session.user.id,
      });
      return toDto(row);
    }),

  reset: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        id: z.string(),
        endUserId: z.string().optional(),
        reason: z.string().max(500).optional(),
      }),
    )
    .permission("gatewayBudgets:update")
    .mutation(async ({ ctx, input }) => {
      const service = GatewayBudgetService.create(
        ctx.prisma,
        getApp().gateway.budgets,
      );
      const row = await service.reset({
        id: input.id,
        organizationId: input.organizationId,
        actorUserId: ctx.session.user.id,
        endUserId: input.endUserId ?? null,
        reason: input.reason ?? null,
      });
      return toDto(row);
    }),
});

function toDto(b: GatewayBudgetWithSeats) {
  // Computed, not read off the row: the stored columns only move at create
  // and at an explicit reset, so a budget past its first boundary would
  // otherwise report a period that closed months ago next to this period's
  // spend. See effectiveBudgetPeriod.
  const period = effectiveBudgetPeriod(b);
  return {
    id: b.id,
    organizationId: b.organizationId,
    scopeType: b.scopeType,
    scopeId: b.scopeId,
    name: b.name,
    description: b.description,
    window: b.window,
    onBreach: b.onBreach,
    limitUsd: b.limitUsd.toString(),
    spentUsd: b.spentUsd.toString(),
    timezone: b.timezone,
    providerKey: b.providerKey,
    currentPeriodStartedAt: period.currentPeriodStartedAt.toISOString(),
    resetsAt: period.resetsAt.toISOString(),
    /** Null is calendar alignment; set, it is the phase the window cycles on. */
    cycleAnchorAt: b.cycleAnchorAt?.toISOString() ?? null,
    lastResetAt: b.lastResetAt?.toISOString() ?? null,
    archivedAt: b.archivedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
    // Per-person templates only: how many end users the template saw this
    // period and how many are over their own cap.
    endUsersSeen: b.endUsersSeen ?? null,
    endUsersOver: b.endUsersOver ?? null,
  };
}
