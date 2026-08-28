/**
 * The prompt library over the process's tRPC transport.
 *
 * Transport only: gates, input parsing, the cross-project probes copy/push/sync
 * need, and delegation to `PromptService`.
 */
import {
  createPromptCreateTrpcInputSchema,
  createPromptUpdateTrpcInputSchema,
  hoistSystemMessage,
  promptAssignTagTrpcInputSchema,
  promptConfigTagsTrpcInputSchema,
  promptCopyTrpcInputSchema,
  promptGetByIdOrHandleTrpcInputSchema,
  promptHandleUniquenessTrpcInputSchema,
  promptIdOrHandleTrpcInputSchema,
  promptProjectTrpcInputSchema,
  promptPushToCopiesTrpcInputSchema,
  promptRestoreVersionTrpcInputSchema,
  PromptTagValidationError,
  promptUpdateHandleTrpcInputSchema,
} from "@langwatch/prompt-contract";
import { nodeDatasetSchema } from "@langwatch/workflow-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
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
      ).query(async ({ ctx, input }) => {
        const service = ctx.app.prompts;
        return await service.getAllPrompts(input);
      }),

      /**
       * Get copies of a prompt for push selection
       */
      getCopies: policy("prompts:view")(procedure.input(promptIdOrHandleTrpcInputSchema)).query(
        async ({ ctx, input }) => {
          const service = ctx.app.prompts;
          const prompt = await service.tryGetPromptByIdOrHandle({
            idOrHandle: input.idOrHandle,
            projectId: input.projectId,
          });

          if (!prompt) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Prompt not found",
            });
          }

          const copies = await service.listCopies({ sourcePromptId: prompt.id });

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
        const service = ctx.app.prompts;
        const authorId = ctx.actor().id;
        return await service.restoreVersion({
          ...input,
          authorId,
        });
      }),

      /**
       * Create a new prompt
       */
      create: policy("prompts:create")(procedure.input(createInputSchema)).mutation(
        async ({ ctx, input }) => {
          const service = ctx.app.prompts;
          const authorId = ctx.actor().id;

          const result = await service.createPrompt({
            ...input.data,
            projectId: input.projectId,
            authorId,
          });

          ports.afterPromptCreated({
            projectId: input.projectId,
            userId: authorId,
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
        async ({ ctx, input }) => {
          const service = ctx.app.prompts;
          const authorId = ctx.actor().id;

          return await service.updatePrompt({
            idOrHandle: input.id,
            projectId: input.projectId,
            data: {
              ...input.data,
              authorId,
            },
          });
        },
      ),

      /**
       * Update only the handle and scope without creating a new version
       */
      updateHandle: policy("prompts:update")(
        procedure.input(promptUpdateHandleTrpcInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const service = ctx.app.prompts;
        return await service.updateHandle({
          idOrHandle: input.id,
          projectId: input.projectId,
          data: input.data,
        });
      }),

      /**
       * Get a prompt by id
       */
      getByIdOrHandle: policy("prompts:view")(
        procedure.input(promptGetByIdOrHandleTrpcInputSchema),
      ).query(async ({ ctx, input }) => {
        try {
          const service = ctx.app.prompts;
          return await service.tryGetPromptByIdOrHandle(input);
        } catch (error) {
          if (error instanceof PromptTagValidationError) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: error.message,
            });
          }
          // A `NotFoundError` is a `HandledError` carrying `prompt_not_found`.
          // `handledErrorMiddleware` maps it to NOT_FOUND and the client reads
          // its copy off the code, so re-wrapping it here only discarded the
          // code in favour of one-off prose.
          throw error;
        }
      }),

      /**
       * Check if a handle is unique for a project
       */
      checkHandleUniqueness: policy("prompts:view")(
        procedure.input(promptHandleUniquenessTrpcInputSchema),
      ).query(async ({ ctx, input }) => {
        const service = ctx.app.prompts;
        return await service.checkHandleUniqueness(input);
      }),

      /**
       * Check if user can modify/delete a prompt
       */
      checkModifyPermission: policy("prompts:view")(
        procedure.input(promptIdOrHandleTrpcInputSchema),
      ).query(async ({ ctx, input }) => {
        const service = ctx.app.prompts;
        return await service.checkModifyPermission(input);
      }),

      /**
       * Get all versions for a prompt
       */
      getAllVersionsForPrompt: policy("prompts:view")(
        procedure.input(promptIdOrHandleTrpcInputSchema),
      ).query(async ({ ctx, input }) => {
        const service = ctx.app.prompts;
        return await service.getAllVersions(input);
      }),

      /**
       * Delete a prompt
       */
      delete: policy("prompts:delete")(procedure.input(promptIdOrHandleTrpcInputSchema)).mutation(
        async ({ ctx, input }) => {
          const service = ctx.app.prompts;
          return await service.deletePrompt(input);
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
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "You do not have permission to create prompts in the source project",
            });
          }

          const service = ctx.app.prompts;
          const authorId = ctx.actor().id;

          // A missing source prompt raises `prompt_not_found`, a HandledError:
          // `handledErrorMiddleware` gives it the NOT_FOUND tRPC code and the
          // client reads its copy off that code. Nothing to re-wrap.
          const copiedPrompt = await service.copyPrompt({
            idOrHandle: input.idOrHandle,
            sourceProjectId: input.sourceProjectId,
            targetProjectId: input.projectId,
            authorId,
          });

          ports.afterPromptCreated({
            projectId: input.projectId,
            userId: authorId,
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
        const service = ctx.app.prompts;
        const authorId = ctx.actor().id;

        const duplicatedPrompt = await service.duplicatePrompt({
          idOrHandle: input.idOrHandle,
          projectId: input.projectId,
          authorId,
        });

        ports.afterPromptCreated({
          projectId: input.projectId,
          userId: authorId,
        });

        return duplicatedPrompt;
      }),

      /**
       * Sync a copied prompt from its source
       */
      syncFromSource: policy("prompts:update")(
        procedure.input(promptIdOrHandleTrpcInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const service = ctx.app.prompts;
        const authorId = ctx.actor().id;

        // Get the prompt (copy)
        const prompt = await service.tryGetPromptByIdOrHandle({
          idOrHandle: input.idOrHandle,
          projectId: input.projectId,
        });

        if (!prompt) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Prompt not found",
          });
        }

        const copySource = await service.tryGetCopySource({ promptId: prompt.id });
        if (!copySource) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This prompt is not a copy and has no source to sync from",
          });
        }

        // Check permissions on source project
        const hasSourcePermission = await ctx.can("prompts:view", {
          projectId: copySource.sourceProjectId,
        });

        if (!hasSourcePermission) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "You do not have permission to view prompts in the source project",
          });
        }

        // Get source prompt using service to get properly formatted data
        const sourcePrompt = await service.tryGetPromptByIdOrHandle({
          idOrHandle: copySource.sourcePromptId,
          projectId: copySource.sourceProjectId,
        });

        if (!sourcePrompt) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Source prompt not found",
          });
        }

        // Normalize prompt/messages to avoid system prompt conflict
        const { prompt: normalizedPrompt, messages: normalizedMessages } = hoistSystemMessage({
          prompt: sourcePrompt.prompt,
          messages: sourcePrompt.messages,
        });

        // Update the copy with source's data
        return await service.updatePrompt({
          idOrHandle: input.idOrHandle,
          projectId: input.projectId,
          data: {
            commitMessage: `Updated from source prompt "${sourcePrompt.handle ?? sourcePrompt.id}"`,
            prompt: normalizedPrompt,
            messages: normalizedMessages,
            inputs: sourcePrompt.inputs,
            outputs: sourcePrompt.outputs,
            model: sourcePrompt.model,
            temperature: sourcePrompt.temperature,
            ...(sourcePrompt.maxTokens != null && {
              maxTokens: sourcePrompt.maxTokens,
            }),
            // Traditional sampling parameters
            ...(sourcePrompt.topP != null && { topP: sourcePrompt.topP }),
            ...(sourcePrompt.frequencyPenalty != null && {
              frequencyPenalty: sourcePrompt.frequencyPenalty,
            }),
            ...(sourcePrompt.presencePenalty != null && {
              presencePenalty: sourcePrompt.presencePenalty,
            }),
            // Other sampling parameters
            ...(sourcePrompt.seed != null && { seed: sourcePrompt.seed }),
            ...(sourcePrompt.topK != null && { topK: sourcePrompt.topK }),
            ...(sourcePrompt.minP != null && { minP: sourcePrompt.minP }),
            ...(sourcePrompt.repetitionPenalty != null && {
              repetitionPenalty: sourcePrompt.repetitionPenalty,
            }),
            // Reasoning parameter (canonical/unified field)
            ...(sourcePrompt.reasoning != null && {
              reasoning: sourcePrompt.reasoning,
            }),
            ...(sourcePrompt.verbosity != null && {
              verbosity: sourcePrompt.verbosity,
            }),
            ...(sourcePrompt.promptingTechnique != null && {
              promptingTechnique: sourcePrompt.promptingTechnique,
            }),
            demonstrations: sourcePrompt.demonstrations,
            parameters: sourcePrompt.parameters,
            authorId,
          },
        });
      }),

      /**
       * Push a source prompt to all its copies
       */
      pushToCopies: policy("prompts:update")(
        procedure.input(promptPushToCopiesTrpcInputSchema),
      ).mutation(async ({ ctx, input }) => {
        const service = ctx.app.prompts;
        const authorId = ctx.actor().id;

        // Get the source prompt
        const sourcePrompt = await service.tryGetPromptByIdOrHandle({
          idOrHandle: input.idOrHandle,
          projectId: input.projectId,
        });

        if (!sourcePrompt) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Prompt not found",
          });
        }

        const copies = await service.listCopies({ sourcePromptId: sourcePrompt.id });
        if (copies.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This prompt has no copies to push to",
          });
        }

        // Filter copies if copyIds is provided
        const copiesToPush = input.copyIds
          ? copies.filter((copy) => input.copyIds!.includes(copy.id))
          : copies;

        if (copiesToPush.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No valid copies selected to push to",
          });
        }

        const results = [];

        // Push to each copy
        for (const copy of copiesToPush) {
          // Check permissions on copy's project
          const hasCopyPermission = await ctx.can("prompts:update", { projectId: copy.projectId });

          if (!hasCopyPermission) {
            // Skip copies where user doesn't have permission
            continue;
          }

          // Normalize prompt/messages to avoid system prompt conflict
          const { prompt: normalizedPrompt, messages: normalizedMessages } = hoistSystemMessage({
            prompt: sourcePrompt.prompt,
            messages: sourcePrompt.messages,
          });

          // Update the copy with source's data
          const updated = await service.updatePrompt({
            idOrHandle: copy.id,
            projectId: copy.projectId,
            data: {
              commitMessage: `Pushed from source prompt "${
                sourcePrompt.handle ?? sourcePrompt.id
              }"`,
              prompt: normalizedPrompt,
              messages: normalizedMessages,
              inputs: sourcePrompt.inputs,
              outputs: sourcePrompt.outputs,
              model: sourcePrompt.model,
              temperature: sourcePrompt.temperature,
              ...(sourcePrompt.maxTokens != null && {
                maxTokens: sourcePrompt.maxTokens,
              }),
              // Traditional sampling parameters
              ...(sourcePrompt.topP != null && { topP: sourcePrompt.topP }),
              ...(sourcePrompt.frequencyPenalty != null && {
                frequencyPenalty: sourcePrompt.frequencyPenalty,
              }),
              ...(sourcePrompt.presencePenalty != null && {
                presencePenalty: sourcePrompt.presencePenalty,
              }),
              // Other sampling parameters
              ...(sourcePrompt.seed != null && { seed: sourcePrompt.seed }),
              ...(sourcePrompt.topK != null && { topK: sourcePrompt.topK }),
              ...(sourcePrompt.minP != null && { minP: sourcePrompt.minP }),
              ...(sourcePrompt.repetitionPenalty != null && {
                repetitionPenalty: sourcePrompt.repetitionPenalty,
              }),
              // Reasoning parameter (canonical/unified field)
              ...(sourcePrompt.reasoning != null && {
                reasoning: sourcePrompt.reasoning,
              }),
              ...(sourcePrompt.verbosity != null && {
                verbosity: sourcePrompt.verbosity,
              }),
              ...(sourcePrompt.promptingTechnique != null && {
                promptingTechnique: sourcePrompt.promptingTechnique,
              }),
              demonstrations: sourcePrompt.demonstrations,
              parameters: sourcePrompt.parameters,
              ...(sourcePrompt.responseFormat != null && {
                responseFormat: sourcePrompt.responseFormat,
              }),
              authorId,
            },
          });

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
      ).query(async ({ ctx, input }) => {
        const service = ctx.app.prompts;
        return service.getTagsForConfig({
          configId: input.configId,
          projectId: input.projectId,
        });
      }),

      /**
       * Assign (or reassign) a tag to a specific prompt version.
       * Accepts built-in tags (production, staging) and custom tags defined for the org.
       */
      assignTag: policy("prompts:update")(procedure.input(promptAssignTagTrpcInputSchema)).mutation(
        async ({ ctx, input }) => {
          const service = ctx.app.prompts;

          try {
            return await service.assignTag({
              configId: input.configId,
              versionId: input.versionId,
              tag: input.tag,
              projectId: input.projectId,
              userId: ctx.actor().id,
            });
          } catch (error) {
            if (error instanceof PromptTagValidationError) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: error.message,
              });
            }
            throw error;
          }
        },
      ),
    });
  }
}
