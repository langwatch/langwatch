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
import { toVirtualKeyCamelDto } from "~/server/gateway/virtualKey.dto";
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
      return keys.map((vk) => toListItem(vk));
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
      return toDetail(vk);
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

const toListItem = toVirtualKeyCamelDto;
const toDetail = toVirtualKeyCamelDto;
