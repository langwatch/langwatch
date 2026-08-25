import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { afterPromptCreated } from "~/server/app-layer/billing/nurturing/promptCreation";
import { PromptScope } from "~/generated/prisma/client";
import { nodeDatasetSchema } from "~/optimization_studio/types/dsl";
import {
  handleSchema,
  inputsSchema,
  messageSchema,
  outputsSchema,
  promptingTechniqueSchema,
  responseFormatSchema,
  runtimeParametersSchema,
} from "@langwatch/prompt-contract";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { hoistSystemMessage } from "@langwatch/prompt-contract";
import { PromptTagValidationError } from "@langwatch/prompt-contract";
import { createTRPCRouter, protectedProcedure } from "../../trpc";

/**
 * Router for handling prompts - the business-facing interface
 */
export const promptsRouter = createTRPCRouter({
  /**
   * Get all prompts for project
   */
  getAllPromptsForProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("prompts:view")
    .query(async ({ ctx, input }) => {
      const service = ctx.app.prompts;
      return await service.getAllPrompts(input);
    }),

  /**
   * Get copies of a prompt for push selection
   */
  getCopies: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        idOrHandle: z.string(),
      }),
    )
    .permission("prompts:view")
    .query(async ({ ctx, input }) => {
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
          const hasPermission = await probeProjectPermission(
            ctx,
            copy.projectId,
            "prompts:update",
          );
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
    }),

  /**
   * Restore a prompt version
   */
  restoreVersion: protectedProcedure
    .input(
      z.object({
        versionId: z.string(),
        projectId: z.string(),
      }),
    )
    .permission("prompts:update")
    .mutation(async ({ ctx, input }) => {
      const service = ctx.app.prompts;
      const authorId = ctx.session?.user?.id;
      return await service.restoreVersion({
        ...input,
        authorId,
      });
    }),

  /**
   * Create a new prompt
   */
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        data: z.object({
          scope: z.nativeEnum(PromptScope).optional(),
          authorId: z.string().optional(),
          commitMessage: z.string().optional(),
          prompt: z.string().optional(),
          messages: z.array(messageSchema).optional(),
          inputs: z.array(inputsSchema).optional(),
          outputs: z.array(outputsSchema).optional(),
          model: z.string().optional(),
          temperature: z.number().optional(),
          maxTokens: z.number().optional(),
          // Traditional sampling parameters
          topP: z.number().optional(),
          frequencyPenalty: z.number().optional(),
          presencePenalty: z.number().optional(),
          // Other sampling parameters
          seed: z.number().optional(),
          topK: z.number().optional(),
          minP: z.number().optional(),
          repetitionPenalty: z.number().optional(),
          // Reasoning parameter (canonical/unified field)
          reasoning: z.string().optional(),
          verbosity: z.string().optional(),
          promptingTechnique: promptingTechniqueSchema.optional(),
          responseFormat: responseFormatSchema.optional(),
          demonstrations: nodeDatasetSchema.optional(),
          handle: handleSchema,
          parameters: runtimeParametersSchema.optional(),
        }),
      }),
    )
    .permission("prompts:create")
    .mutation(async ({ ctx, input }) => {
      const service = ctx.app.prompts;
      const authorId = ctx.session?.user?.id;

      const result = await service.createPrompt({
        ...input.data,
        projectId: input.projectId,
        authorId,
      });

      afterPromptCreated({
        prisma: ctx.prisma,
        projectId: input.projectId,
        userId: authorId,
      });

      return result;
    }),

  /**
   * Update a prompt (creates a new version, requires commitMessage)
   * Scope and handle should not be updated here since they do not create a new version/require a commit message.
   * Use the updateHandle method instead for those.
   */
  update: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        data: z.object({
          commitMessage: z.string(),
          authorId: z.string().optional(),
          prompt: z.string().optional(),
          messages: z.array(messageSchema).optional(),
          inputs: z.array(inputsSchema).optional(),
          outputs: z.array(outputsSchema).optional(),
          model: z.string().optional(),
          temperature: z.number().optional(),
          maxTokens: z.number().optional(),
          // Traditional sampling parameters
          topP: z.number().optional(),
          frequencyPenalty: z.number().optional(),
          presencePenalty: z.number().optional(),
          // Other sampling parameters
          seed: z.number().optional(),
          topK: z.number().optional(),
          minP: z.number().optional(),
          repetitionPenalty: z.number().optional(),
          // Reasoning parameter (canonical/unified field)
          reasoning: z.string().optional(),
          verbosity: z.string().optional(),
          promptingTechnique: promptingTechniqueSchema.optional(),
          responseFormat: responseFormatSchema.optional(),
          demonstrations: nodeDatasetSchema.optional(),
          parameters: runtimeParametersSchema.optional(),
        }),
      }),
    )
    .permission("prompts:update")
    .mutation(async ({ ctx, input }) => {
      const service = ctx.app.prompts;
      const authorId = ctx.session?.user?.id;

      return await service.updatePrompt({
        idOrHandle: input.id,
        projectId: input.projectId,
        data: {
          ...input.data,
          authorId,
        },
      });
    }),

  /**
   * Update only the handle and scope without creating a new version
   */
  updateHandle: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        id: z.string(),
        data: z.object({
          handle: handleSchema,
          scope: z.nativeEnum(PromptScope),
        }),
      }),
    )
    .permission("prompts:update")
    .mutation(async ({ ctx, input }) => {
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
  getByIdOrHandle: protectedProcedure
    .input(
      z.object({
        idOrHandle: z.string(),
        projectId: z.string(),
        /** Optional: fetch a specific version by ID */
        versionId: z.string().optional(),
        /** Optional: fetch a specific version by number */
        version: z.number().optional(),
        /** Optional: fetch the version pointed to by this tag */
        tag: z.string().optional(),
      }),
    )
    .permission("prompts:view")
    .query(async ({ ctx, input }) => {
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
  checkHandleUniqueness: protectedProcedure
    .input(
      z.object({
        handle: handleSchema,
        projectId: z.string(),
        scope: z.nativeEnum(PromptScope),
      }),
    )
    .permission("prompts:view")
    .query(async ({ ctx, input }) => {
      const service = ctx.app.prompts;
      return await service.checkHandleUniqueness(input);
    }),

  /**
   * Check if user can modify/delete a prompt
   */
  checkModifyPermission: protectedProcedure
    .input(
      z.object({
        idOrHandle: z.string(),
        projectId: z.string(),
      }),
    )
    .permission("prompts:view")
    .query(async ({ ctx, input }) => {
      const service = ctx.app.prompts;
      return await service.checkModifyPermission(input);
    }),

  /**
   * Get all versions for a prompt
   */
  getAllVersionsForPrompt: protectedProcedure
    .input(
      z.object({
        idOrHandle: z.string(),
        projectId: z.string(),
      }),
    )
    .permission("prompts:view")
    .query(async ({ ctx, input }) => {
      const service = ctx.app.prompts;
      return await service.getAllVersions(input);
    }),

  /**
   * Delete a prompt
   */
  delete: protectedProcedure
    .input(
      z.object({
        idOrHandle: z.string(),
        projectId: z.string(),
      }),
    )
    .permission("prompts:delete")
    .mutation(async ({ ctx, input }) => {
      const service = ctx.app.prompts;
      return await service.deletePrompt(input);
    }),

  /**
   * Copy a prompt to another project
   */
  copy: protectedProcedure
    .input(
      z.object({
        idOrHandle: z.string(),
        projectId: z.string(),
        sourceProjectId: z.string(),
      }),
    )
    .permission("prompts:create")
    .mutation(async ({ ctx, input }) => {
      // Check that the user has at least prompts:create permission on the source project
      const hasSourcePermission = await probeProjectPermission(
        ctx,
        input.sourceProjectId,
        "prompts:create",
      );

      if (!hasSourcePermission) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "You do not have permission to create prompts in the source project",
        });
      }

      const service = ctx.app.prompts;
      const authorId = ctx.session?.user?.id;

      // A missing source prompt raises `prompt_not_found`, a HandledError:
      // `handledErrorMiddleware` gives it the NOT_FOUND tRPC code and the
      // client reads its copy off that code. Nothing to re-wrap.
      const copiedPrompt = await service.copyPrompt({
        idOrHandle: input.idOrHandle,
        sourceProjectId: input.sourceProjectId,
        targetProjectId: input.projectId,
        authorId,
      });

      afterPromptCreated({
        prisma: ctx.prisma,
        projectId: input.projectId,
        userId: authorId,
      });

      return copiedPrompt;
    }),

  /**
   * Duplicate a prompt within the project it already belongs to.
   * Unlike `copy`, this never crosses project boundaries.
   */
  duplicate: protectedProcedure
    .input(
      z.object({
        idOrHandle: z.string(),
        projectId: z.string(),
      }),
    )
    .permission("prompts:create")
    .mutation(async ({ ctx, input }) => {
      const service = ctx.app.prompts;
      const authorId = ctx.session?.user?.id;

      const duplicatedPrompt = await service.duplicatePrompt({
        idOrHandle: input.idOrHandle,
        projectId: input.projectId,
        authorId,
      });

      afterPromptCreated({
        prisma: ctx.prisma,
        projectId: input.projectId,
        userId: authorId,
      });

      return duplicatedPrompt;
    }),

  /**
   * Sync a copied prompt from its source
   */
  syncFromSource: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        idOrHandle: z.string(),
      }),
    )
    .permission("prompts:update")
    .mutation(async ({ ctx, input }) => {
      const service = ctx.app.prompts;
      const authorId = ctx.session?.user?.id;

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
      const hasSourcePermission = await probeProjectPermission(
        ctx,
        copySource.sourceProjectId,
        "prompts:view",
      );

      if (!hasSourcePermission) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "You do not have permission to view prompts in the source project",
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
      const { prompt: normalizedPrompt, messages: normalizedMessages } =
        hoistSystemMessage({
          prompt: sourcePrompt.prompt,
          messages: sourcePrompt.messages,
        });

      // Update the copy with source's data
      return await service.updatePrompt({
        idOrHandle: input.idOrHandle,
        projectId: input.projectId,
        data: {
          commitMessage: `Updated from source prompt "${
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
          authorId,
        },
      });
    }),

  /**
   * Push a source prompt to all its copies
   */
  pushToCopies: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        idOrHandle: z.string(),
        copyIds: z.array(z.string()).optional(), // Optional: if provided, only push to selected copies
      }),
    )
    .permission("prompts:update")
    .mutation(async ({ ctx, input }) => {
      const service = ctx.app.prompts;
      const authorId = ctx.session?.user?.id;

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
        ? copies.filter((copy) =>
            input.copyIds!.includes(copy.id),
          )
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
        const hasCopyPermission = await probeProjectPermission(
          ctx,
          copy.projectId,
          "prompts:update",
        );

        if (!hasCopyPermission) {
          // Skip copies where user doesn't have permission
          continue;
        }

        // Normalize prompt/messages to avoid system prompt conflict
        const { prompt: normalizedPrompt, messages: normalizedMessages } =
          hoistSystemMessage({
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
          message:
            "You do not have permission to update any of the copied prompts",
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
  getTagsForConfig: protectedProcedure
    .input(z.object({ projectId: z.string(), configId: z.string() }))
    .permission("prompts:view")
    .query(async ({ ctx, input }) => {
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
  assignTag: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        configId: z.string(),
        versionId: z.string(),
        tag: z.string().min(1),
      }),
    )
    .permission("prompts:update")
    .mutation(async ({ ctx, input }) => {
      const service = ctx.app.prompts;

      try {
        return await service.assignTag({
          configId: input.configId,
          versionId: input.versionId,
          tag: input.tag,
          projectId: input.projectId,
          userId: ctx.session?.user?.id,
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
    }),
});
