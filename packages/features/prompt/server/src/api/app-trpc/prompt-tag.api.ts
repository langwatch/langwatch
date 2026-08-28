/**
 * Prompt tag definitions over the process's tRPC transport.
 *
 * The organization's custom tag catalog (for example, behind
 * DeployPromptDialog). A tag is an organization-level name, so every
 * procedure resolves the project's organization first and the declared check
 * still gates on the project the caller named.
 *
 * Transport only: gates, input parsing and delegation to `PromptService`.
 */
import {
  PromptTagConflictError,
  PromptTagNotFoundError,
  PromptTagProtectedError,
  PromptTagValidationError,
} from "@langwatch/prompt-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
import type { PromptTrpcContext, PromptTrpcProcedures } from "./prompt.trpc-context";

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

/** Installs the complete `promptTags.*` tRPC surface on a process-owned root. */
export class PromptTagTrpcApi {
  static create<
    TContext extends PromptTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: PromptTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    return trpc.router({
      /**
       * Returns all prompt tag definitions for the project's organization.
       */
      getAll: policy("prompts:view")(procedure.input(z.object({ projectId: z.string() }))).query(
        async ({ ctx, input }) => {
          const organizationId = await ctx.app.projects.getOrganizationId(input.projectId);

          return ctx.app.prompts.listTags({ organizationId });
        },
      ),

      /**
       * Creates a custom tag definition for the project's organization.
       */
      create: policy("prompts:manage")(
        procedure.input(z.object({ projectId: z.string(), name: z.string() })),
      ).mutation(async ({ ctx, input }) => {
        const organizationId = await ctx.app.projects.getOrganizationId(input.projectId);

        try {
          return await ctx.app.prompts.createTag({
            organizationId,
            name: input.name,
            createdById: ctx.actor().id,
          });
        } catch (error) {
          mapServiceError(error);
        }
      }),

      /**
       * Renames a tag definition and updates all corresponding assignments.
       */
      rename: policy("prompts:manage")(
        procedure.input(
          z.object({
            projectId: z.string(),
            oldName: z.string(),
            newName: z.string(),
          }),
        ),
      ).mutation(async ({ ctx, input }) => {
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
      delete: policy("prompts:manage")(
        procedure.input(z.object({ projectId: z.string(), name: z.string() })),
      ).mutation(async ({ ctx, input }) => {
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
  }
}
