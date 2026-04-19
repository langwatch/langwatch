/**
 * tRPC router for gateway budgets.
 *
 * Budgets are always organization-scoped but the resource target is one of
 * ORGANIZATION / TEAM / PROJECT / VIRTUAL_KEY / PRINCIPAL. The UI flows pass
 * a scope kind + target id; the server normalises onto `scopeType` and the
 * matching typed FK column.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { GatewayBudgetService } from "~/server/gateway/budget.service";

import { checkOrganizationPermission, checkProjectPermission } from "../rbac";
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
]);

async function requireOrgAccess(
  ctx: { prisma: import("@prisma/client").PrismaClient },
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
    .use(checkOrganizationPermission("gatewayBudgets:view"))
    .query(async ({ ctx, input }) => {
      await requireOrgAccess(ctx, input.organizationId);
      const service = GatewayBudgetService.create(ctx.prisma);
      const rows = await service.list(input.organizationId);
      const scopeTargets = await resolveScopeTargetsBatch(ctx.prisma, rows);
      return rows.map((b) => ({
        ...toDto(b),
        scopeTarget: scopeTargets.get(`${b.scopeType}:${b.scopeId}`) ?? null,
      }));
    }),

  listForProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("gatewayBudgets:view"))
    .query(async ({ ctx, input }) => {
      const service = GatewayBudgetService.create(ctx.prisma);
      const rows = await service.listForProject(input.projectId);
      const scopeTargets = await resolveScopeTargetsBatch(ctx.prisma, rows);
      return rows.map((b) => ({
        ...toDto(b),
        scopeTarget: scopeTargets.get(`${b.scopeType}:${b.scopeId}`) ?? null,
      }));
    }),

  get: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .use(checkOrganizationPermission("gatewayBudgets:view"))
    .query(async ({ ctx, input }) => {
      await requireOrgAccess(ctx, input.organizationId);
      const service = GatewayBudgetService.create(ctx.prisma);
      const detail = await service.getDetail(input.id, input.organizationId);
      if (!detail) {
        throw new TRPCError({ code: "NOT_FOUND", message: "budget not found" });
      }
      return {
        ...toDto(detail.budget),
        scopeTarget: detail.scopeTarget,
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

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        scope: scopeSchema,
        name: z.string().min(1).max(128),
        description: z.string().optional(),
        window: z.enum(["MINUTE", "HOUR", "DAY", "WEEK", "MONTH", "TOTAL"]),
        limitUsd: z.number().positive().or(z.string()),
        onBreach: z.enum(["BLOCK", "WARN"]).optional(),
        timezone: z.string().nullable().optional(),
      }),
    )
    .use(checkOrganizationPermission("gatewayBudgets:create"))
    .mutation(async ({ ctx, input }) => {
      const service = GatewayBudgetService.create(ctx.prisma);
      const row = await service.create({
        organizationId: input.organizationId,
        scope: input.scope,
        name: input.name,
        description: input.description ?? null,
        window: input.window,
        limitUsd: input.limitUsd,
        onBreach: input.onBreach,
        timezone: input.timezone ?? null,
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
    .use(checkOrganizationPermission("gatewayBudgets:update"))
    .mutation(async ({ ctx, input }) => {
      const service = GatewayBudgetService.create(ctx.prisma);
      const row = await service.update({
        ...input,
        actorUserId: ctx.session.user.id,
      });
      return toDto(row);
    }),

  archive: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .use(checkOrganizationPermission("gatewayBudgets:delete"))
    .mutation(async ({ ctx, input }) => {
      const service = GatewayBudgetService.create(ctx.prisma);
      const row = await service.archive({
        ...input,
        actorUserId: ctx.session.user.id,
      });
      return toDto(row);
    }),
});

export type BudgetListScopeTarget = {
  kind: string;
  id: string;
  name: string;
  secondary: string | null;
  projectSlug?: string | null;
};

// Batch-resolves scope target (name + secondary) for a list of budgets,
// grouping by scopeType so each scope gets at most one findMany. Detail
// view uses the equivalent per-budget path in GatewayBudgetService; list
// needed its own implementation to avoid N queries per page.
async function resolveScopeTargetsBatch(
  prisma: import("@prisma/client").PrismaClient,
  budgets: Array<{ scopeType: string; scopeId: string }>,
): Promise<Map<string, BudgetListScopeTarget>> {
  const ids: Record<string, Set<string>> = {
    ORGANIZATION: new Set(),
    TEAM: new Set(),
    PROJECT: new Set(),
    VIRTUAL_KEY: new Set(),
    PRINCIPAL: new Set(),
  };
  for (const b of budgets) {
    ids[b.scopeType]?.add(b.scopeId);
  }
  const [orgs, teams, projects, vks, users] = await Promise.all([
    ids.ORGANIZATION?.size
      ? prisma.organization.findMany({
          where: { id: { in: [...ids.ORGANIZATION!] } },
          select: { id: true, name: true, slug: true },
        })
      : Promise.resolve([]),
    ids.TEAM?.size
      ? prisma.team.findMany({
          where: { id: { in: [...ids.TEAM!] } },
          select: { id: true, name: true, slug: true },
        })
      : Promise.resolve([]),
    ids.PROJECT?.size
      ? prisma.project.findMany({
          where: { id: { in: [...ids.PROJECT!] } },
          select: { id: true, name: true, slug: true },
        })
      : Promise.resolve([]),
    ids.VIRTUAL_KEY?.size
      ? prisma.virtualKey.findMany({
          where: { id: { in: [...ids.VIRTUAL_KEY!] } },
          select: {
            id: true,
            name: true,
            displayPrefix: true,
            project: { select: { slug: true } },
          },
        })
      : Promise.resolve([]),
    ids.PRINCIPAL?.size
      ? prisma.user.findMany({
          where: { id: { in: [...ids.PRINCIPAL!] } },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
  ]);
  const out = new Map<string, BudgetListScopeTarget>();
  for (const o of orgs) {
    out.set(`ORGANIZATION:${o.id}`, {
      kind: "ORGANIZATION",
      id: o.id,
      name: o.name,
      secondary: o.slug,
    });
  }
  for (const t of teams) {
    out.set(`TEAM:${t.id}`, {
      kind: "TEAM",
      id: t.id,
      name: t.name,
      secondary: t.slug,
    });
  }
  for (const p of projects) {
    out.set(`PROJECT:${p.id}`, {
      kind: "PROJECT",
      id: p.id,
      name: p.name,
      secondary: p.slug,
    });
  }
  for (const vk of vks) {
    out.set(`VIRTUAL_KEY:${vk.id}`, {
      kind: "VIRTUAL_KEY",
      id: vk.id,
      name: vk.name,
      secondary: vk.displayPrefix ? `${vk.displayPrefix}…` : null,
      projectSlug: vk.project?.slug ?? null,
    });
  }
  for (const u of users) {
    out.set(`PRINCIPAL:${u.id}`, {
      kind: "PRINCIPAL",
      id: u.id,
      name: u.name ?? u.email ?? u.id,
      secondary: u.email ?? null,
    });
  }
  return out;
}

function toDto(b: import("@prisma/client").GatewayBudget) {
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
    currentPeriodStartedAt: b.currentPeriodStartedAt.toISOString(),
    resetsAt: b.resetsAt.toISOString(),
    lastResetAt: b.lastResetAt?.toISOString() ?? null,
    archivedAt: b.archivedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
  };
}
