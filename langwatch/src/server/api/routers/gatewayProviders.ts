/**
 * tRPC router for gateway provider-credential bindings.
 *
 * A binding layers gateway-only settings (rate limits, rotation policy,
 * extra headers) on top of an existing `ModelProvider` row — we never
 * duplicate the raw API key. Virtual keys reference these bindings via the
 * `VirtualKeyProviderCredential` join table.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { GatewayProviderCredentialService } from "~/server/gateway/providerCredential.service";

import { checkOrganizationPermission, checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

async function orgForProject(
  ctx: { prisma: import("@prisma/client").PrismaClient },
  projectId: string,
) {
  const project = await ctx.prisma.project.findUnique({
    where: { id: projectId },
    include: { team: true },
  });
  if (!project) {
    throw new TRPCError({ code: "NOT_FOUND", message: "project not found" });
  }
  return project.team.organizationId;
}

export const gatewayProvidersRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("gatewayProviders:view"))
    .query(async ({ ctx, input }) => {
      const service = GatewayProviderCredentialService.create(ctx.prisma);
      const rows = await service.getAll(input.projectId);
      return rows.map((row) => ({
        id: row.id,
        modelProviderId: row.modelProviderId,
        modelProviderName: row.modelProvider.provider,
        modelProviderEnabled: row.modelProvider.enabled,
        slot: row.slot,
        rateLimitRpm: row.rateLimitRpm,
        rateLimitTpm: row.rateLimitTpm,
        rateLimitRpd: row.rateLimitRpd,
        rotationPolicy: row.rotationPolicy,
        fallbackPriorityGlobal: row.fallbackPriorityGlobal,
        healthStatus: row.healthStatus,
        circuitOpenedAt: row.circuitOpenedAt?.toISOString() ?? null,
        disabledAt: row.disabledAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      }));
    }),

  /**
   * G19 — list every gateway provider credential reachable from any project
   * in the org. Powers the structured multi-select on the org-scoped routing
   * policy drawer. Project-level callers should keep using `list`.
   */
  listForOrg: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:manage"))
    .query(async ({ ctx, input }) => {
      const service = GatewayProviderCredentialService.create(ctx.prisma);
      const rows = await service.getAllForOrg(input.organizationId);
      return rows.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        modelProviderId: row.modelProviderId,
        modelProviderName: row.modelProvider.provider,
        modelProviderEnabled: row.modelProvider.enabled,
        slot: row.slot,
        healthStatus: row.healthStatus,
        disabledAt: row.disabledAt?.toISOString() ?? null,
      }));
    }),

  /**
   * G88 — count active gateway bindings pointing at a given ModelProvider,
   * scoped to the org (ModelProvider rows are org-/team-/project-scoped, so
   * a single MP can be bound across multiple projects in the org). Used by
   * /settings/model-providers' disable dialog to warn the admin that
   * disabling will leave bindings in an unusable state.
   */
  countByModelProvider: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        modelProviderId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:manage"))
    .query(async ({ ctx, input }) => {
      const service = GatewayProviderCredentialService.create(ctx.prisma);
      const rows = await service.getAllForOrg(input.organizationId);
      return rows.filter(
        (row) => row.modelProviderId === input.modelProviderId,
      ).length;
    }),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        modelProviderId: z.string(),
        slot: z.string().optional(),
        rateLimitRpm: z.number().int().positive().nullable().optional(),
        rateLimitTpm: z.number().int().positive().nullable().optional(),
        rateLimitRpd: z.number().int().positive().nullable().optional(),
        rotationPolicy: z.enum(["MANUAL"]).optional(),
        extraHeaders: z.record(z.string(), z.string()).nullable().optional(),
        providerConfig: z.record(z.string(), z.any()).nullable().optional(),
        fallbackPriorityGlobal: z.number().int().nullable().optional(),
      }),
    )
    .use(checkProjectPermission("gatewayProviders:manage"))
    .mutation(async ({ ctx, input }) => {
      const organizationId = await orgForProject(ctx, input.projectId);
      const service = GatewayProviderCredentialService.create(ctx.prisma);
      return service.create({
        ...input,
        organizationId,
        actorUserId: ctx.session.user.id,
      });
    }),

  update: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        slot: z.string().optional(),
        rateLimitRpm: z.number().int().positive().nullable().optional(),
        rateLimitTpm: z.number().int().positive().nullable().optional(),
        rateLimitRpd: z.number().int().positive().nullable().optional(),
        rotationPolicy: z.enum(["MANUAL"]).optional(),
        extraHeaders: z.record(z.string(), z.string()).nullable().optional(),
        providerConfig: z.record(z.string(), z.any()).nullable().optional(),
        fallbackPriorityGlobal: z.number().int().nullable().optional(),
      }),
    )
    .use(checkProjectPermission("gatewayProviders:manage"))
    .mutation(async ({ ctx, input }) => {
      const organizationId = await orgForProject(ctx, input.projectId);
      const service = GatewayProviderCredentialService.create(ctx.prisma);
      return service.update({
        ...input,
        organizationId,
        actorUserId: ctx.session.user.id,
      });
    }),

  disable: protectedProcedure
    .input(z.object({ projectId: z.string(), id: z.string() }))
    .use(checkProjectPermission("gatewayProviders:manage"))
    .mutation(async ({ ctx, input }) => {
      const organizationId = await orgForProject(ctx, input.projectId);
      const service = GatewayProviderCredentialService.create(ctx.prisma);
      return service.disable({
        id: input.id,
        projectId: input.projectId,
        organizationId,
        actorUserId: ctx.session.user.id,
      });
    }),
});
