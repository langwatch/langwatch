import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  PromptTagConflictError,
  PromptTagNotFoundError,
  PromptTagProtectedError,
  PromptTagValidationError,
} from "@langwatch/prompt-contract";
import { createTRPCRouter, protectedProcedure } from "../trpc";

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
    .permission("prompts:view")
    .query(async ({ ctx, input }) => {
      const organizationId = await ctx.app.projects.getOrganizationId(input.projectId);

      return ctx.app.prompts.listTags({ organizationId });
    }),

  /**
   * Creates a custom tag definition for the project's organization.
   */
  create: protectedProcedure
    .input(z.object({ projectId: z.string(), name: z.string() }))
    .permission("prompts:manage")
    .mutation(async ({ ctx, input }) => {
      const organizationId = await ctx.app.projects.getOrganizationId(input.projectId);

      try {
        return await ctx.app.prompts.createTag({
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
    .permission("prompts:manage")
    .mutation(async ({ ctx, input }) => {
      const organizationId = await ctx.app.projects.getOrganizationId(input.projectId);

      try {
        return await ctx.app.prompts.renameTag({
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
    .permission("prompts:manage")
    .mutation(async ({ ctx, input }) => {
      const organizationId = await ctx.app.projects.getOrganizationId(input.projectId);

      try {
        const tag = await ctx.app.prompts.tryDeleteTagByName({
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
