/**
 * Prompt tag definitions over the process's tRPC transport.
 */
import { createTrpcService } from "@langwatch/api/trpc";
import { PermissionDeniedError } from "@langwatch/authz-contract";
import { promptDeleteResultSchema, promptTagSchema } from "@langwatch/prompt-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type {
  PromptTrpcContext,
  PromptTrpcProcedures,
} from "../../rules/prompt-trpc-context.rules.ts";

/**
 * A tag definition is one organization row and its assignments cascade to every project in
 * that organization, so the project the caller named is only the first of the scopes the
 * write reaches. Which projects, and the refusal, belong to the application — the REST door
 * asks the same question of its own credential; only the translation to a tRPC code is this
 * transport's.
 */
async function assertMayManageEveryProject(
  ctx: PromptTrpcContext,
  input: { projectId: string },
): Promise<void> {
  try {
    await ctx.app.prompts.assertMayManageTagCatalog({
      projectId: input.projectId,
      mayManage: ({ projectId }) => ctx.can("prompts:manage", { projectId }),
    });
  } catch (error) {
    if (!(error instanceof PermissionDeniedError)) throw error;
    throw new TRPCError({ code: "UNAUTHORIZED", message: error.message, cause: error });
  }
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
    const { protected: procedure, policy, validateOutput } = procedures;

    return createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      .query("getAll", (p) =>
        p
          .withInput(z.object({ projectId: z.string() }))
          .withOutput(promptTagSchema.array())
          .withPermission("prompts:view")
          /** Every prompt tag definition in the project's organization. */
          .handle(async ({ ctx, input }) =>
            ctx.app.prompts.listTagsForProject({ projectId: input.projectId }),
          ),
      )
      .mutation("create", (p) =>
        p
          .withInput(z.object({ projectId: z.string(), name: z.string() }))
          .withOutput(promptTagSchema)
          .withPermission("prompts:manage")
          /** A custom tag definition for the project's organization. */
          .handle(async ({ ctx, input }) =>
            ctx.app.prompts.createTagForProject(
              { projectId: input.projectId, name: input.name },
              ctx.actor(),
            ),
          ),
      )
      .mutation("rename", (p) =>
        p
          .withInput(
            z.object({
              projectId: z.string(),
              oldName: z.string(),
              newName: z.string(),
            }),
          )
          .withOutput(promptTagSchema)
          .withPermission("prompts:manage")
          /** Renames a tag definition and every assignment that names it. */
          .handle(async ({ ctx, input }) => {
            await assertMayManageEveryProject(ctx, { projectId: input.projectId });
            return ctx.app.prompts.renameTagForProject({
              projectId: input.projectId,
              oldName: input.oldName,
              newName: input.newName,
            });
          }),
      )
      .mutation("delete", (p) =>
        p
          .withInput(z.object({ projectId: z.string(), name: z.string() }))
          .withOutput(promptDeleteResultSchema)
          .withPermission("prompts:manage")
          /** Deletes a tag definition by name and cascades to assignments. */
          .handle(async ({ ctx, input }) => {
            await assertMayManageEveryProject(ctx, { projectId: input.projectId });
            await ctx.app.prompts.deleteTagForProject({
              projectId: input.projectId,
              name: input.name,
            });
            return { success: true };
          }),
      )
      .build();
  }
}
