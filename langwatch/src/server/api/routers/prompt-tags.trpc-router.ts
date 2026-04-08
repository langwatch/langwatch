import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  PromptTagConflictError,
  PromptTagNotFoundError,
  PromptTagProtectedError,
  PromptTagService,
  PromptTagValidationError,
} from "~/server/prompt-config/prompt-tag.service";
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
 * Maps domain errors from the PromptTagService to tRPC errors.
 */
function mapServiceError(error: unknown): never {
  if (error instanceof PromptTagValidationError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  if (error instanceof PromptTagConflictError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error instanceof PromptTagProtectedError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  if (error instanceof PromptTagNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  throw error;
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

  /**
   * Creates a custom tag definition for the project's organization.
   */
  create: protectedProcedure
    .input(z.object({ projectId: z.string(), name: z.string() }))
    .use(checkProjectPermission("prompts:manage"))
    .mutation(async ({ ctx, input }) => {
      const organizationId = await resolveOrganizationId(
        ctx.prisma,
        input.projectId,
      );

      const service = PromptTagService.create(ctx.prisma);
      try {
        return await service.create({
          organizationId,
          name: input.name,
          createdById: ctx.session.user.id,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /**
   * Renames a tag definition and updates all corresponding assignments.
   */
  rename: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        oldName: z.string(),
        newName: z.string(),
      }),
    )
    .use(checkProjectPermission("prompts:manage"))
    .mutation(async ({ ctx, input }) => {
      const organizationId = await resolveOrganizationId(
        ctx.prisma,
        input.projectId,
      );

      const service = PromptTagService.create(ctx.prisma);
      try {
        return await service.rename({
          organizationId,
          oldName: input.oldName,
          newName: input.newName,
        });
      } catch (error) {
        mapServiceError(error);
      }
    }),

  /**
   * Deletes a tag definition by name and cascades to assignments.
   */
  delete: protectedProcedure
    .input(z.object({ projectId: z.string(), name: z.string() }))
    .use(checkProjectPermission("prompts:manage"))
    .mutation(async ({ ctx, input }) => {
      const organizationId = await resolveOrganizationId(
        ctx.prisma,
        input.projectId,
      );

      const service = PromptTagService.create(ctx.prisma);
      try {
        const tag = await service.deleteByName({
          organizationId,
          name: input.name,
        });

        if (!tag) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Tag not found: ${input.name}`,
          });
        }

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        mapServiceError(error);
      }
    }),
});
