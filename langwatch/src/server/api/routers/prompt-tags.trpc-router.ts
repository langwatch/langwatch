import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { PromptTagService } from "~/server/prompt-config/prompt-tag.service";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * Resolves the organizationId from a projectId via the project → team chain.
 *
 * @throws {TRPCError} NOT_FOUND if the project does not exist
 */
async function resolveOrganizationId(
  prisma: PrismaClient,
  projectId: string,
): Promise<string> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { team: { select: { organizationId: true } } },
  });

  if (!project?.team?.organizationId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Project not found",
    });
  }

  return project.team.organizationId;
}

/**
 * tRPC router for prompt tag definitions.
 * Provides access to the org's custom tag catalog (e.g. for DeployPromptDialog).
 */
export const promptTagsRouter = createTRPCRouter({
  /**
   * Returns all prompt tag definitions for the project's organization.
   */
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("prompts:view"))
    .query(async ({ ctx, input }) => {
      const organizationId = await resolveOrganizationId(
        ctx.prisma,
        input.projectId,
      );

      const service = PromptTagService.create(ctx.prisma);
      return service.getAll({ organizationId });
    }),
});
