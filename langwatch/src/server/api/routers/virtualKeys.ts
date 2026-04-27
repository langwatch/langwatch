/**
 * tRPC router for the AI Gateway virtual-keys surface. UI calls these
 * procedures; the service layer runs in `~/server/gateway/virtualKey.service`.
 *
 * RBAC: every procedure guards on a project-scoped permission. Routes never
 * talk to the repository directly — they go through the service.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { VirtualKeyService } from "~/server/gateway/virtualKey.service";
import { virtualKeyConfigSchema } from "~/server/gateway/virtualKey.config";
import {
  type EnrichedChainEntry,
  toVirtualKeyCamelDto,
} from "~/server/gateway/virtualKey.dto";
import type { VirtualKeyWithChain } from "~/server/gateway/virtualKey.repository";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

async function resolveOrganizationForProject(
  ctx: { prisma: import("@prisma/client").PrismaClient },
  projectId: string,
) {
  const project = await ctx.prisma.project.findUnique({
    where: { id: projectId },
    include: { team: true },
  });
  if (!project) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Project ${projectId} not found`,
    });
  }
  return { projectId: project.id, organizationId: project.team.organizationId };
}

const idInput = z.object({ projectId: z.string(), id: z.string() });

export const virtualKeysRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("virtualKeys:view"))
    .query(async ({ ctx, input }) => {
      const service = VirtualKeyService.create(ctx.prisma);
      const keys = await service.getAll(input.projectId);
      // Batch-enrich all chains in one query for the whole list so
      // rows can render provider-type icons without an N+1. One
      // findMany over GatewayProviderCredential, grouped client-side.
      const enrichedByVk = await enrichChainsForList(ctx.prisma, keys);
      return keys.map((vk) => toVirtualKeyCamelDto(vk, enrichedByVk.get(vk.id) ?? []));
    }),

  get: protectedProcedure
    .input(idInput)
    .use(checkProjectPermission("virtualKeys:view"))
    .query(async ({ ctx, input }) => {
      const service = VirtualKeyService.create(ctx.prisma);
      const vk = await service.getById(input.id, input.projectId);
      if (!vk) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const enriched = await enrichChain(ctx.prisma, vk);
      return toVirtualKeyCamelDto(vk, enriched);
    }),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(1).max(128),
        description: z.string().optional(),
        environment: z.enum(["live", "test"]).default("live"),
        principalUserId: z.string().nullable().optional(),
        providerCredentialIds: z.array(z.string()).min(1),
        config: virtualKeyConfigSchema.partial().optional(),
      }),
    )
    .use(checkProjectPermission("virtualKeys:create"))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = await resolveOrganizationForProject(
        ctx,
        input.projectId,
      );
      const service = VirtualKeyService.create(ctx.prisma);
      const { virtualKey, secret } = await service.create({
        projectId: input.projectId,
        organizationId,
        name: input.name,
        description: input.description ?? null,
        environment: input.environment,
        principalUserId: input.principalUserId ?? null,
        providerCredentialIds: input.providerCredentialIds,
        actorUserId: ctx.session.user.id,
        config: input.config,
      });
      return { virtualKey: toDetail(virtualKey), secret };
    }),

  update: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        name: z.string().min(1).max(128).optional(),
        description: z.string().nullable().optional(),
        providerCredentialIds: z.array(z.string()).min(1).optional(),
        config: virtualKeyConfigSchema.partial().optional(),
      }),
    )
    .use(checkProjectPermission("virtualKeys:update"))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = await resolveOrganizationForProject(
        ctx,
        input.projectId,
      );
      const service = VirtualKeyService.create(ctx.prisma);
      const updated = await service.update({
        id: input.id,
        projectId: input.projectId,
        organizationId,
        actorUserId: ctx.session.user.id,
        name: input.name,
        description: input.description,
        providerCredentialIds: input.providerCredentialIds,
        config: input.config,
      });
      return toDetail(updated);
    }),

  rotate: protectedProcedure
    .input(idInput)
    .use(checkProjectPermission("virtualKeys:rotate"))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = await resolveOrganizationForProject(
        ctx,
        input.projectId,
      );
      const service = VirtualKeyService.create(ctx.prisma);
      const { virtualKey, secret } = await service.rotate({
        id: input.id,
        projectId: input.projectId,
        organizationId,
        actorUserId: ctx.session.user.id,
      });
      return { virtualKey: toDetail(virtualKey), secret };
    }),

  revoke: protectedProcedure
    .input(idInput)
    .use(checkProjectPermission("virtualKeys:update"))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = await resolveOrganizationForProject(
        ctx,
        input.projectId,
      );
      const service = VirtualKeyService.create(ctx.prisma);
      const updated = await service.revoke({
        id: input.id,
        projectId: input.projectId,
        organizationId,
        actorUserId: ctx.session.user.id,
      });
      return toDetail(updated);
    }),
});

// List rows don't render the enriched chain — they show a compact
// "fallback chain length" badge — so we keep the empty-chain shape
// for performance (no N×2 joins on list pagination). Detail view
// calls enrichChain() explicitly.
const toListItem = toVirtualKeyCamelDto;
const toDetail = toVirtualKeyCamelDto;

async function enrichChainsForList(
  prisma: import("@prisma/client").PrismaClient,
  vks: VirtualKeyWithChain[],
): Promise<Map<string, EnrichedChainEntry[]>> {
  const allIds = new Set<string>();
  for (const vk of vks) {
    for (const pc of vk.providerCredentials) {
      allIds.add(pc.providerCredentialId);
    }
  }
  if (allIds.size === 0 || vks.length === 0) return new Map();
  const projectId = vks[0]!.projectId;
  const rows = await prisma.gatewayProviderCredential.findMany({
    where: { projectId, id: { in: [...allIds] } },
    select: {
      id: true,
      slot: true,
      modelProvider: { select: { provider: true } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const result = new Map<string, EnrichedChainEntry[]>();
  for (const vk of vks) {
    const entries: EnrichedChainEntry[] = [];
    vk.providerCredentials.forEach((pc, idx) => {
      const row = byId.get(pc.providerCredentialId);
      if (!row) return;
      entries.push({
        providerCredentialId: pc.providerCredentialId,
        slot: row.slot ?? (idx === 0 ? "primary" : `fallback-${idx}`),
        providerType: row.modelProvider.provider,
      });
    });
    result.set(vk.id, entries);
  }
  return result;
}

async function enrichChain(
  prisma: import("@prisma/client").PrismaClient,
  vk: VirtualKeyWithChain,
): Promise<EnrichedChainEntry[]> {
  const ids = vk.providerCredentials.map((pc) => pc.providerCredentialId);
  if (ids.length === 0) return [];
  const rows = await prisma.gatewayProviderCredential.findMany({
    where: { projectId: vk.projectId, id: { in: ids } },
    select: {
      id: true,
      slot: true,
      modelProvider: { select: { provider: true } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return vk.providerCredentials
    .map((pc, idx): EnrichedChainEntry | null => {
      const row = byId.get(pc.providerCredentialId);
      if (!row) return null;
      return {
        providerCredentialId: pc.providerCredentialId,
        slot: row.slot ?? (idx === 0 ? "primary" : `fallback-${idx}`),
        providerType: row.modelProvider.provider,
      };
    })
    .filter((e): e is EnrichedChainEntry => e !== null);
}
