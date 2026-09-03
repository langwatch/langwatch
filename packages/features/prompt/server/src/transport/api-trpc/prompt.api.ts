/**
 * The prompt library over the process's tRPC transport.
 *
 * Transport only: gates, input parsing, the cross-project probes copy/push/sync
 * need, and delegation to {@link PromptApp}. Attribution, the not-found
 * refusals and what a copy receives from its source all live on the
 * application, where a second door reaches the same answers.
 */
import type {
  PromptAssignTagTrpcOutput,
  PromptConfigTagsTrpcOutput,
  PromptCreateTrpcOutput,
  PromptGetAllForProjectTrpcOutput,
  PromptGetAllVersionsTrpcOutput,
  PromptGetByIdOrHandleTrpcOutput,
  PromptHandleUniquenessTrpcOutput,
  PromptUpdateHandleTrpcOutput,
  PromptUpdateTrpcOutput,
} from "@langwatch/prompt-contract";
import {
  createPromptCreateTrpcInputSchema,
  createPromptUpdateTrpcInputSchema,
  promptAssignTagTrpcInputSchema,
  promptConfigTagsTrpcInputSchema,
  promptCopyTrpcInputSchema,
  promptGetByIdOrHandleTrpcInputSchema,
  promptHandleUniquenessTrpcInputSchema,
  promptIdOrHandleTrpcInputSchema,
  promptProjectTrpcInputSchema,
  promptPushToCopiesTrpcInputSchema,
  promptRestoreVersionTrpcInputSchema,
  promptUpdateHandleTrpcInputSchema,
} from "@langwatch/prompt-contract";
import { nodeDatasetSchema } from "@langwatch/workflow-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { PromptApp, PromptHasNoCopiesError, PromptNoCopiesSelectedError } from "#app/prompt.app";
import type {
  PromptTrpcContext,
  PromptTrpcPorts,
  PromptTrpcProcedures,
} from "./prompt.trpc-context";

/** Installs the complete `prompts.*` tRPC surface on a process-owned root. */
export class PromptTrpcApi {
  static create<
    TContext extends PromptTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: PromptTrpcProcedures<TContext, TOptions, TRoot>,
    ports: PromptTrpcPorts,
  ) {
    const { protected: procedure, policy } = procedures;
    // Built here rather than in the contract: `demonstrations` is a workflow
    // dataset, and the workflow contract already depends on the prompt one, so
    // the shape takes the schema instead of importing it into a cycle.
    const createInputSchema = createPromptCreateTrpcInputSchema({
      demonstrationsSchema: nodeDatasetSchema,
    });
    const updateInputSchema = createPromptUpdateTrpcInputSchema({
      demonstrationsSchema: nodeDatasetSchema,
    });

    return trpc.router({
      /**
       * Get all prompts for project
       */
      getAllPromptsForProject: policy("prompts:view")(
        procedure.input(promptProjectTrpcInputSchema),
      ).query(async ({ ctx, input }): Promise<PromptGetAllForProjectTrpcOutput> => {
        return await ctx.app.prompts.listForProject(input);
      }),

      /**
       * Get copies of a prompt for push selection
       */
      getCopies: policy("prompts:view")(procedure.input(promptIdOrHandleTrpcInputSchema)).query(
        async ({ ctx, input }) => {
          const prompt = await ctx.app.prompts.getByIdOrHandle({
            idOrHandle: input.idOrHandle,
            projectId: input.projectId,
          });

          const copies = await ctx.app.prompts.listCopies({ sourcePromptId: prompt.id });

          // Filter copies based on user's prompts:update permission
          const copiesWithPermissions = await Promise.all(
            copies.map(async (copy) => {
              const hasPermission = await ctx.can("prompts:update", { projectId: copy.projectId });
              return {
                id: copy.id,
                handle: copy.handle ?? copy.id,
                projectId: copy.projectId,
                projectName: copy.projectName,
                teamName: copy.teamName,
                organizationName: copy.organizationName,
                fullPath: `${copy.organizationName} / ${copy.teamName} / ${copy.projectName}`,
                hasPermission,
              };
            }),
          );

          // Only return copies where user has permission
          return copiesWithPermissions.filter((copy) => copy.hasPermission);
        },
      ),

      /**
       * Restore a prompt version
       */
      restoreVersion: policy("prompts:update")(
        procedure.input(promptRestoreVersionTrpcInputSchema),
      ).mutation(async ({ ctx, input }) => {
        return await ctx.app.prompts.restoreVersion(input, ctx.actor());
      }),

      /**
       * Create a new prompt
       */
      create: policy("prompts:create")(procedure.input(createInputSchema)).mutation(
        async ({ ctx, input }): Promise<PromptCreateTrpcOutput> => {
          const author = ctx.actor();

          const result = await ctx.app.prompts.create(
            { ...input.data, projectId: input.projectId },
            author,
          );

          ports.afterPromptCreated({
            projectId: input.projectId,
            userId: author.id,
          });

          return result;
        },
      ),

      /**
       * Update a prompt (creates a new version, requires commitMessage)
       * Scope and handle should not be updated here since they do not create a new version/require a commit message.
       * Use the updateHandle method instead for those.
       */
      update: policy("prompts:update")(procedure.input(updateInputSchema)).mutation(
        async ({ ctx, input }): Promise<PromptUpdateTrpcOutput> => {
          return await ctx.app.prompts.update(
            {
              idOrHandle: input.id,
              projectId: input.projectId,
              data: input.data,
            },
            ctx.actor(),
          );
        },
      ),

      /**
       * Update only the handle and scope without creating a new version
       */
      updateHandle: policy("prompts:update")(
        procedure.input(promptUpdateHandleTrpcInputSchema),
      ).mutation(async ({ ctx, input }): Promise<PromptUpdateHandleTrpcOutput> => {
        return await ctx.app.prompts.updateHandle({
          idOrHandle: input.id,
          projectId: input.projectId,
          data: input.data,
        });
      }),

      /**
       * Get a prompt by id
       *
       * A `NotFoundError` is a `HandledError` carrying `prompt_not_found`, and
       * an invalid tag reference is one carrying `prompt_tag_invalid`. Both are
       * raised by the application, `handledErrorMiddleware` maps them to their
       * statuses and the client reads its copy off the code, so there is
       * nothing here to re-wrap.
       */
      getByIdOrHandle: policy("prompts:view")(
        procedure.input(promptGetByIdOrHandleTrpcInputSchema),
      ).query(async ({ ctx, input }): Promise<PromptGetByIdOrHandleTrpcOutput> => {
        return await ctx.app.prompts.tryGetByIdOrHandle(input);
      }),

      /**
       * Check if a handle is unique for a project
       */
      checkHandleUniqueness: policy("prompts:view")(
        procedure.input(promptHandleUniquenessTrpcInputSchema),
      ).query(async ({ ctx, input }): Promise<PromptHandleUniquenessTrpcOutput> => {
        return await ctx.app.prompts.checkHandleUniqueness(input);
      }),

      /**
       * Check if user can modify/delete a prompt
       */
      checkModifyPermission: policy("prompts:view")(
        procedure.input(promptIdOrHandleTrpcInputSchema),
      ).query(async ({ ctx, input }) => {
        return await ctx.app.prompts.checkModifyPermission(input);
      }),

      /**
       * Get all versions for a prompt
       */
      getAllVersionsForPrompt: policy("prompts:view")(
        procedure.input(promptIdOrHandleTrpcInputSchema),
      ).query(async ({ ctx, input }): Promise<PromptGetAllVersionsTrpcOutput> => {
        return await ctx.app.prompts.listVersions(input);
      }),

      /**
       * Delete a prompt
       */
      delete: policy("prompts:delete")(procedure.input(promptIdOrHandleTrpcInputSchema)).mutation(
        async ({ ctx, input }) => {
          return await ctx.app.prompts.delete(input);
        },
      ),

      /**
       * Copy a prompt to another project
       */
      copy: policy("prompts:create")(procedure.input(promptCopyTrpcInputSchema)).mutation(
        async ({ ctx, input }) => {
          // Check that the user has at least prompts:create permission on the source project
          const hasSourcePermission = await ctx.can("prompts:create", {
            projectId: input.sourceProjectId,
          });

          if (!hasSourcePermission) {
            // Left as a raw TRPCError deliberately. `ProjectPermissionDeniedError`
            // is the right handled shape for this, and it is a 403 — this
            // refusal has always answered UNAUTHORIZED (401). Converting it
            // moves the wire status, which is a behaviour change the client's
            // sign-in handling can see, so it is reported rather than taken
            // here. The same holds for the two below.
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "You do not have permission to create prompts in the source project",
            });
          }

          const author = ctx.actor();

          // A missing source prompt raises `prompt_not_found`, a HandledError:
          // `handledErrorMiddleware` gives it the NOT_FOUND tRPC code and the
          // client reads its copy off that code. Nothing to re-wrap.
          const copiedPrompt = await ctx.app.prompts.copyToProject(
            {
              idOrHandle: input.idOrHandle,
              sourceProjectId: input.sourceProjectId,
              targetProjectId: input.projectId,
            },
            author,
          );

          ports.afterPromptCreated({
            projectId: input.projectId,
            userId: author.id,
          });

          return copiedPrompt;
        },
      ),

      /**
       * Duplicate a prompt within the project it already belongs to.
       * Unlike `copy`, this never crosses project boundaries.
       */
      duplicate: policy("prompts:create")(
        procedure.input(promptIdOrHandleTrpcInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const author = ctx.actor();

        const duplicatedPrompt = await ctx.app.prompts.duplicate(
          { idOrHandle: input.idOrHandle, projectId: input.projectId },
          author,
        );

        ports.afterPromptCreated({
          projectId: input.projectId,
          userId: author.id,
        });

        return duplicatedPrompt;
      }),

      /**
       * Sync a copied prompt from its source
       */
      syncFromSource: policy("prompts:update")(
        procedure.input(promptIdOrHandleTrpcInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const author = ctx.actor();

        // The copy. A missing one raises `prompt_not_found`; a prompt that was
        // never copied from anywhere raises `prompt_not_a_copy`.
        const copy = await ctx.app.prompts.getByIdOrHandle({
          idOrHandle: input.idOrHandle,
          projectId: input.projectId,
        });
        const copySource = await ctx.app.prompts.getCopySource({ promptId: copy.id });

        // The declared check gated the copy's project; the source is a SECOND
        // project this input names, so it is probed here.
        const hasSourcePermission = await ctx.can("prompts:view", {
          projectId: copySource.sourceProjectId,
        });

        if (!hasSourcePermission) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "You do not have permission to view prompts in the source project",
          });
        }

        const source = await ctx.app.prompts.getByIdOrHandle({
          idOrHandle: copySource.sourcePromptId,
          projectId: copySource.sourceProjectId,
        });

        return await ctx.app.prompts.applySourceToCopy(
          {
            source,
            targetIdOrHandle: input.idOrHandle,
            targetProjectId: input.projectId,
            commitMessage: PromptApp.commitMessageFor("synced", source),
          },
          author,
        );
      }),

      /**
       * Push a source prompt to all its copies
       */
      pushToCopies: policy("prompts:update")(
        procedure.input(promptPushToCopiesTrpcInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const author = ctx.actor();

        const source = await ctx.app.prompts.getByIdOrHandle({
          idOrHandle: input.idOrHandle,
          projectId: input.projectId,
        });

        const copies = await ctx.app.prompts.listCopies({ sourcePromptId: source.id });
        if (copies.length === 0) throw new PromptHasNoCopiesError();

        // Filter copies if copyIds is provided
        const copiesToPush = input.copyIds
          ? copies.filter((copy) => input.copyIds!.includes(copy.id))
          : copies;

        if (copiesToPush.length === 0) throw new PromptNoCopiesSelectedError();

        const commitMessage = PromptApp.commitMessageFor("pushed", source);
        const results = [];

        // Push to each copy
        for (const copy of copiesToPush) {
          // Each copy lives in a SECOND project this input names, so the
          // declared check does not cover it; a copy the caller cannot update
          // is skipped rather than failing the whole push.
          const hasCopyPermission = await ctx.can("prompts:update", { projectId: copy.projectId });
          if (!hasCopyPermission) continue;

          const updated = await ctx.app.prompts.applySourceToCopy(
            {
              source,
              targetIdOrHandle: copy.id,
              targetProjectId: copy.projectId,
              commitMessage,
            },
            author,
          );

          results.push({
            copyId: copy.id,
            copyName: copy.handle ?? copy.id,
            prompt: updated,
          });
        }

        if (results.length === 0) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "You do not have permission to update any of the copied prompts",
          });
        }

        return {
          pushedTo: results.length,
          totalCopies: copies.length,
          selectedCopies: copiesToPush.length,
          results,
        };
      }),

      // --- Tag Operations ---

      /**
       * Get all tags for a prompt config.
       */
      getTagsForConfig: policy("prompts:view")(
        procedure.input(promptConfigTagsTrpcInputSchema),
      ).query(async ({ ctx, input }): Promise<PromptConfigTagsTrpcOutput> => {
        return ctx.app.prompts.getTagsForConfig({
          configId: input.configId,
          projectId: input.projectId,
        });
      }),

      /**
       * Assign (or reassign) a tag to a specific prompt version.
       * Accepts built-in tags (production, staging) and custom tags defined for the org.
       */
      assignTag: policy("prompts:update")(procedure.input(promptAssignTagTrpcInputSchema)).mutation(
        async ({ ctx, input }): Promise<PromptAssignTagTrpcOutput> => {
          return await ctx.app.prompts.assignTag(
            {
              configId: input.configId,
              versionId: input.versionId,
              tag: input.tag,
              projectId: input.projectId,
            },
            ctx.actor(),
          );
        },
      ),
    });
  }
}
