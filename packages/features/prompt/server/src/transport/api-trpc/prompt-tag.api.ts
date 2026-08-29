/**
 * Prompt tag definitions over the process's tRPC transport.
 *
 * The organization's custom tag catalog (for example, behind
 * DeployPromptDialog). A tag is an organization-level name, and resolving the
 * project's organization is the application's job, not this door's — the
 * declared check still gates on the project the caller named.
 *
 * Transport only: gates, input parsing and delegation to {@link PromptApp}.
 * The tag service's domain failures reach the boundary as coded handled errors
 * raised by the application, so there is no translation table here.
 */
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import type { PromptTrpcContext, PromptTrpcProcedures } from "./prompt.trpc-context";

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
        async ({ ctx, input }) =>
          ctx.app.prompts.listTagsForProject({ projectId: input.projectId }),
      ),

      /**
       * Creates a custom tag definition for the project's organization.
       */
      create: policy("prompts:manage")(
        procedure.input(z.object({ projectId: z.string(), name: z.string() })),
      ).mutation(async ({ ctx, input }) =>
        ctx.app.prompts.createTagForProject(
          { projectId: input.projectId, name: input.name },
          ctx.actor(),
        ),
      ),

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
      ).mutation(async ({ ctx, input }) =>
        ctx.app.prompts.renameTagForProject({
          projectId: input.projectId,
          oldName: input.oldName,
          newName: input.newName,
        }),
      ),

      /**
       * Deletes a tag definition by name and cascades to assignments.
       */
      delete: policy("prompts:manage")(
        procedure.input(z.object({ projectId: z.string(), name: z.string() })),
      ).mutation(async ({ ctx, input }) => {
        await ctx.app.prompts.deleteTagForProject({
          projectId: input.projectId,
          name: input.name,
        });
        return { success: true };
      }),
    });
  }
}
