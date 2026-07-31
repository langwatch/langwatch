/**
 * tRPC router for gateway budgets.
 *
 * Budgets are always organization-scoped but the resource target is one of
 * ORGANIZATION / TEAM / PROJECT / VIRTUAL_KEY / PRINCIPAL / GROUP. The UI
 * flows pass a scope kind + target id; the server normalises onto
 * `scopeType` and the matching typed FK column.
 */

import { z } from "zod";
import { isClickHouseEnabled } from "~/server/app-layer/clients/clickhouse/shared";
import { clickHouseForProject } from "~/server/app-layer/clients/clickhouse/tenant-resolver";
import { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import { GatewayBudgetService } from "~/server/gateway/budget.service";
import { GatewayBudgetNotFoundError } from "~/server/gateway/errors";
import {
  providerLabelFor,
  resolveProviderLabels,
} from "~/server/gateway/providerLabels";
import { OrganizationNotFoundError } from "../../../../ee/licensing/errors";

import { checkOrganizationPermission, checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

function chRepoOrUndefined() {
  if (!isClickHouseEnabled()) return undefined;
  return new GatewayBudgetClickHouseRepository(async (projectId) => {
    const client = await clickHouseForProject(projectId);
    if (!client) {
      throw new Error(
        `ClickHouse enabled but no client for project ${projectId}`,
      );
    }
    return client;
  });
}

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
  ctx: { prisma: import("@prisma/client").PrismaClient },
  organizationId: string,
) {
  const org = await ctx.prisma.organization.findUnique({
    where: { id: organizationId },
  });
  if (!org) {
    throw new OrganizationNotFoundError();
  }
}

export const gatewayBudgetsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("gatewayBudgets:view"))
    .query(async ({ ctx, input }) => {
      await requireOrgAccess(ctx, input.organizationId);
      const service = GatewayBudgetService.create(
        ctx.prisma,
        chRepoOrUndefined(),
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
          scopeTarget: scopeTargets.get(`${b.scopeType}:${b.scopeId}`) ?? null,
          providerLabel: providerLabelFor(providerLabels, b.providerKey),
        })),
      };
    }),

  listForProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("gatewayBudgets:view"))
    .query(async ({ ctx, input }) => {
      const service = GatewayBudgetService.create(
        ctx.prisma,
        chRepoOrUndefined(),
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
          scopeTarget: scopeTargets.get(`${b.scopeType}:${b.scopeId}`) ?? null,
          providerLabel: providerLabelFor(providerLabels, b.providerKey),
        })),
      };
    }),

  get: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .use(checkOrganizationPermission("gatewayBudgets:view"))
    .query(async ({ ctx, input }) => {
      await requireOrgAccess(ctx, input.organizationId);
      const service = GatewayBudgetService.create(
        ctx.prisma,
        chRepoOrUndefined(),
      );
      const detail = await service.getDetail(input.id, input.organizationId);
      if (!detail) {
        throw new GatewayBudgetNotFoundError();
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
    .use(checkOrganizationPermission("gatewayBudgets:create"))
    .query(async ({ ctx, input }) => {
      const groups = await ctx.prisma.group.findMany({
        where: { organizationId: input.organizationId },
        select: {
          id: true,
          name: true,
          _count: { select: { members: true } },
        },
        orderBy: { name: "asc" },
      });
      return groups.map((g) => ({
        id: g.id,
        name: g.name,
        memberCount: g._count.members,
      }));
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
        // ModelProvider row id. Null / absent = the budget counts every
        // provider; set = it counts and constrains only that provider.
        providerKey: z.string().nullable().optional(),
      }),
    )
    .use(checkOrganizationPermission("gatewayBudgets:create"))
    .mutation(async ({ ctx, input }) => {
      const service = GatewayBudgetService.create(
        ctx.prisma,
        chRepoOrUndefined(),
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
      const service = GatewayBudgetService.create(
        ctx.prisma,
        chRepoOrUndefined(),
      );
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
      const service = GatewayBudgetService.create(
        ctx.prisma,
        chRepoOrUndefined(),
      );
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
  /** GROUP targets only: how many members the per-member allowance covers. */
  memberCount?: number;
};

// Batch-resolves scope target (name + secondary) for a list of budgets,
// grouping by scopeType so each scope gets at most one findMany. Detail
// view uses the equivalent per-budget path in GatewayBudgetService; list
// needed its own implementation to avoid N queries per page.
async function resolveScopeTargetsBatch(
  prisma: import("@prisma/client").PrismaClient,
  budgets: Array<{ scopeType: string; scopeId: string }>,
  organizationId: string | null,
): Promise<Map<string, BudgetListScopeTarget>> {
  const ids: Record<string, Set<string>> = {
    ORGANIZATION: new Set(),
    TEAM: new Set(),
    PROJECT: new Set(),
    VIRTUAL_KEY: new Set(),
    PRINCIPAL: new Set(),
    GROUP: new Set(),
  };
  for (const b of budgets) {
    ids[b.scopeType]?.add(b.scopeId);
  }
  const [orgs, teams, projects, vks, users, groups] = await Promise.all([
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
    ids.VIRTUAL_KEY?.size && organizationId
      ? prisma.virtualKey.findMany({
          where: {
            id: { in: [...ids.VIRTUAL_KEY!] },
            organizationId,
          },
          select: {
            id: true,
            name: true,
            displayPrefix: true,
            scopes: {
              where: { scopeType: "PROJECT" },
              select: { scopeId: true },
              take: 1,
            },
          },
        })
      : Promise.resolve([]),
    ids.PRINCIPAL?.size
      ? prisma.user.findMany({
          where: { id: { in: [...ids.PRINCIPAL!] } },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
    ids.GROUP?.size && organizationId
      ? prisma.group.findMany({
          // Same tenant pin as the VIRTUAL_KEY branch: a stray scopeId
          // must not surface another organization's group name.
          where: { id: { in: [...ids.GROUP!] }, organizationId },
          select: {
            id: true,
            name: true,
            slug: true,
            _count: { select: { members: true } },
          },
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
  // Derive the project slug (if any) from the first PROJECT-scope row
  // on the VK — used only as a UI breadcrumb. Cheap inline lookup; the
  // batch is bounded by `ids.VIRTUAL_KEY.size`.
  const projectIdsForSlugs = vks
    .map((vk) => vk.scopes[0]?.scopeId)
    .filter((id): id is string => typeof id === "string");
  const projectSlugById = new Map<string, string>(
    projectIdsForSlugs.length
      ? (
          await prisma.project.findMany({
            where: { id: { in: projectIdsForSlugs } },
            select: { id: true, slug: true },
          })
        ).map((p) => [p.id, p.slug])
      : [],
  );
  for (const vk of vks) {
    out.set(`VIRTUAL_KEY:${vk.id}`, {
      kind: "VIRTUAL_KEY",
      id: vk.id,
      name: vk.name,
      secondary: vk.displayPrefix ? `${vk.displayPrefix}…` : null,
      projectSlug: projectSlugById.get(vk.scopes[0]?.scopeId ?? "") ?? null,
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
  for (const g of groups) {
    out.set(`GROUP:${g.id}`, {
      kind: "GROUP",
      id: g.id,
      name: g.name,
      secondary: g.slug,
      memberCount: g._count.members,
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
    providerKey: b.providerKey,
    currentPeriodStartedAt: b.currentPeriodStartedAt.toISOString(),
    resetsAt: b.resetsAt.toISOString(),
    lastResetAt: b.lastResetAt?.toISOString() ?? null,
    archivedAt: b.archivedAt?.toISOString() ?? null,
    createdAt: b.createdAt.toISOString(),
  };
}
