import { PromptScope } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { nodeDatasetSchema } from "~/optimization_studio/types/dsl";
import {
  handleSchema,
  inputsSchema,
  messageSchema,
  outputsSchema,
  promptingTechniqueSchema,
  responseFormatSchema,
  runtimeParametersSchema,
} from "~/prompts/schemas";
import { afterPromptCreated } from "~/../ee/billing/nurturing/hooks/promptCreation";
import { enforceLicenseLimit } from "~/server/license-enforcement";
import { PromptService } from "~/server/prompt-config";
import type { VersionedPrompt } from "~/server/prompt-config";
import { NotFoundError } from "~/server/prompt-config/errors";
import { TagValidationError } from "~/server/prompt-config/repositories/llm-config-tag.repository";
import { checkProjectPermission, hasProjectPermission } from "../../rbac";
import { createTRPCRouter, protectedProcedure } from "../../trpc";

/**
 * Normalizes prompt data by extracting system messages from the messages array
 * into the prompt field to avoid conflicts.
 *
 * @param promptData - Object containing prompt and messages fields
 * @returns Normalized prompt and messages, where system messages are moved to prompt field
 */
function normalizePromptData({
  prompt,
  messages,
}: {
  prompt?: string | null;
  messages?: Array<{
    role: "user" | "assistant" | "system";
    content: string;
  }> | null;
}): {
  normalizedPrompt: string | undefined;
  normalizedMessages:
    | Array<{ role: "user" | "assistant" | "system"; content: string }>
    | undefined;
} {
  // Extract system message from messages array
  const systemMessage = messages?.find((msg) => msg.role === "system");
  const nonSystemMessages = messages?.filter(
    (msg): msg is { role: "user" | "assistant"; content: string } =>
      msg.role !== "system",
  );

  // Use system message as prompt if it exists, otherwise use the prompt field
  const normalizedPrompt = systemMessage
    ? systemMessage.content
    : (prompt ?? undefined);

  // Only include messages if there are non-system messages
  const normalizedMessages =
    nonSystemMessages && nonSystemMessages.length > 0
      ? nonSystemMessages
      : undefined;

  return { normalizedPrompt, normalizedMessages };
}

/**
 * Generates a unique handle for a copied/duplicated prompt by retrying with
 * an incrementing suffix (built via `suffixFn`) until `checkHandleUniqueness`
 * reports the candidate is free. Shared between `copy` (cross-project) and
 * `duplicate` (same-project) since both need this exact retry contract.
 */
async function generateUniqueHandle({
  baseHandle,
  suffixFn,
  projectId,
  scope,
  service,
  maxAttempts = 100,
}: {
  baseHandle: string;
  suffixFn: (index: number) => string;
  projectId: string;
  scope: PromptScope;
  service: PromptService;
  maxAttempts?: number;
}): Promise<string> {
  let newHandle = baseHandle;
  let index = 0;
  let handleAvailable = await service.checkHandleUniqueness({
    handle: newHandle,
    projectId,
    scope,
  });

  while (!handleAvailable) {
    index++;
    if (index > maxAttempts) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Failed to generate unique handle after ${maxAttempts} attempts for base handle "${baseHandle}" in project ${projectId}.`,
      });
    }
    newHandle = suffixFn(index);
    handleAvailable = await service.checkHandleUniqueness({
      handle: newHandle,
      projectId,
      scope,
    });
  }

  return newHandle;
}

/**
 * Maps a source prompt's config data into `PromptService.createPrompt` params.
 * Shared between `copy` and `duplicate` so both stay in sync as the prompt
 * schema grows new fields.
 */
function buildCreatePromptParamsFromSource(
  source: VersionedPrompt,
  overrides: {
    projectId: string;
    handle: string;
    authorId?: string;
    commitMessage: string;
    prompt?: string;
    messages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  },
) {
  return {
    projectId: overrides.projectId,
    handle: overrides.handle,
    scope: source.scope ?? "PROJECT",
    authorId: overrides.authorId,
    commitMessage: overrides.commitMessage,
    prompt: overrides.prompt,
    messages: overrides.messages,
    inputs: source.inputs ?? undefined,
    outputs: source.outputs ?? undefined,
    model: source.model ?? undefined,
    temperature: source.temperature ?? undefined,
    maxTokens: source.maxTokens ?? undefined,
    // Traditional sampling parameters
    topP: source.topP ?? undefined,
    frequencyPenalty: source.frequencyPenalty ?? undefined,
    presencePenalty: source.presencePenalty ?? undefined,
    // Other sampling parameters
    seed: source.seed ?? undefined,
    topK: source.topK ?? undefined,
    minP: source.minP ?? undefined,
    repetitionPenalty: source.repetitionPenalty ?? undefined,
    // Reasoning parameter (canonical/unified field)
    reasoning: source.reasoning ?? undefined,
    verbosity: source.verbosity ?? undefined,
    promptingTechnique: source.promptingTechnique ?? undefined,
    demonstrations: source.demonstrations ?? undefined,
    parameters: source.parameters ?? undefined,
  };
}

/**
 * Router for handling prompts - the business-facing interface
 */
export const promptsRouter = createTRPCRouter({
  /**
   * Get all prompts for project
   */
  getAllPromptsForProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("prompts:view"))
    .query(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
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
    .use(checkProjectPermission("prompts:view"))
    .query(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
      const prompt = await service.getPromptByIdOrHandle({
        idOrHandle: input.idOrHandle,
        projectId: input.projectId,
      });

      if (!prompt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt not found",
        });
      }

      const copies = await ctx.prisma.llmPromptConfig.findMany({
        where: {
          copiedFromPromptId: prompt.id,
          deletedAt: null,
        },
        select: {
          id: true,
          handle: true,
          projectId: true,
          project: {
            select: {
              id: true,
              name: true,
              team: {
                select: {
                  id: true,
                  name: true,
                  organization: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      // Filter copies based on user's prompts:update permission
      const copiesWithPermissions = await Promise.all(
        copies.map(async (copy) => {
          const hasPermission = await hasProjectPermission(
            ctx,
            copy.projectId,
            "prompts:update",
          );
          return {
            id: copy.id,
            handle: copy.handle ?? copy.id,
            projectId: copy.projectId,
            projectName: copy.project.name,
            teamName: copy.project.team.name,
            organizationName: copy.project.team.organization.name,
            fullPath: `${copy.project.team.organization.name} / ${copy.project.team.name} / ${copy.project.name}`,
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
    .use(checkProjectPermission("prompts:update"))
    .mutation(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
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
    .use(checkProjectPermission("prompts:create"))
    .mutation(async ({ ctx, input }) => {
      // Enforce prompt limit before creation
      await enforceLicenseLimit(ctx, input.projectId, "prompts");

      const service = new PromptService(ctx.prisma);
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
    .use(checkProjectPermission("prompts:update"))
    .mutation(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
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
    .use(checkProjectPermission("prompts:update"))
    .mutation(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
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
    .use(checkProjectPermission("prompts:view"))
    .query(async ({ ctx, input }) => {
      try {
        const service = new PromptService(ctx.prisma);
        return await service.getPromptByIdOrHandle(input);
      } catch (error) {
        if (error instanceof TagValidationError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
          });
        }
        if (error instanceof NotFoundError) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: error.message,
          });
        }
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
    .use(checkProjectPermission("prompts:view"))
    .query(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
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
    .use(checkProjectPermission("prompts:view"))
    .query(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
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
    .use(checkProjectPermission("prompts:view"))
    .query(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
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
    .use(checkProjectPermission("prompts:delete"))
    .mutation(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
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
    .use(checkProjectPermission("prompts:create"))
    .mutation(async ({ ctx, input }) => {
      // Enforce prompt limit before copying
      await enforceLicenseLimit(ctx, input.projectId, "prompts");

      // Check that the user has at least prompts:create permission on the source project
      const hasSourcePermission = await hasProjectPermission(
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

      const service = new PromptService(ctx.prisma);
      const authorId = ctx.session?.user?.id;

      // Get the source prompt
      const sourcePrompt = await service.getPromptByIdOrHandle({
        idOrHandle: input.idOrHandle,
        projectId: input.sourceProjectId,
      });

      if (!sourcePrompt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt not found",
        });
      }

      const baseHandle = sourcePrompt.handle ?? sourcePrompt.id;
      const newHandle = await generateUniqueHandle({
        baseHandle,
        suffixFn: (i) => `${baseHandle}_copy${i}`,
        projectId: input.projectId,
        scope: sourcePrompt.scope ?? "PROJECT",
        service,
      });

      // Normalize prompt/messages to avoid system prompt conflict
      const { normalizedPrompt, normalizedMessages } = normalizePromptData({
        prompt: sourcePrompt.prompt,
        messages: sourcePrompt.messages,
      });

      // Create the prompt in the target project
      const copiedPrompt = await service.createPrompt(
        buildCreatePromptParamsFromSource(sourcePrompt, {
          projectId: input.projectId,
          handle: newHandle,
          authorId,
          commitMessage: `Copied from "${baseHandle}"`,
          prompt: normalizedPrompt,
          messages: normalizedMessages,
        }),
      );

      // Set the copiedFromPromptId to track the source
      await ctx.prisma.llmPromptConfig.update({
        where: { id: copiedPrompt.id },
        data: { copiedFromPromptId: sourcePrompt.id },
      });

      afterPromptCreated({
        prisma: ctx.prisma,
        projectId: input.projectId,
        userId: authorId,
      });

      return { ...copiedPrompt, copiedFromPromptId: sourcePrompt.id };
    }),

  /**
   * Duplicate a prompt within the same project.
   * Unlike `copy`, this never crosses project boundaries - it always
   * duplicates into the same project the source prompt lives in, using
   * a "handle-1", "handle-2", ... naming scheme. (Parentheses would match
   * common "duplicate" UX conventions more closely, but `handleSchema` only
   * allows lowercase letters/digits/hyphens/underscores/one slash, and a
   * handle that fails it gets silently treated as a legacy/invalid handle
   * and forced into "draft" mode when the prompt is reopened - see
   * `isHandleValid` in `llmPromptConfigUtils.ts`.)
   */
  duplicate: protectedProcedure
    .input(
      z.object({
        idOrHandle: z.string(),
        projectId: z.string(),
      }),
    )
    .use(checkProjectPermission("prompts:create"))
    .mutation(async ({ ctx, input }) => {
      await enforceLicenseLimit(ctx, input.projectId, "prompts");

      const service = new PromptService(ctx.prisma);
      const authorId = ctx.session?.user?.id;

      const sourcePrompt = await service.getPromptByIdOrHandle({
        idOrHandle: input.idOrHandle,
        projectId: input.projectId,
      });

      if (!sourcePrompt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt not found",
        });
      }

      const baseHandle = sourcePrompt.handle ?? sourcePrompt.id;
      const newHandle = await generateUniqueHandle({
        baseHandle: `${baseHandle}-1`,
        // index 1 here means "the base candidate above was taken", so the
        // next candidate is `-2`, not another `-1`.
        suffixFn: (i) => `${baseHandle}-${i + 1}`,
        projectId: input.projectId,
        scope: sourcePrompt.scope ?? "PROJECT",
        service,
      });

      const { normalizedPrompt, normalizedMessages } = normalizePromptData({
        prompt: sourcePrompt.prompt,
        messages: sourcePrompt.messages,
      });

      const duplicatedPrompt = await service.createPrompt(
        buildCreatePromptParamsFromSource(sourcePrompt, {
          projectId: input.projectId,
          handle: newHandle,
          authorId,
          commitMessage: `Duplicated from "${baseHandle}"`,
          prompt: normalizedPrompt,
          messages: normalizedMessages,
        }),
      );

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
    .use(checkProjectPermission("prompts:update"))
    .mutation(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
      const authorId = ctx.session?.user?.id;

      // Get the prompt (copy)
      const prompt = await service.getPromptByIdOrHandle({
        idOrHandle: input.idOrHandle,
        projectId: input.projectId,
      });

      if (!prompt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt not found",
        });
      }

      // Get the raw config to check copiedFromPromptId
      const promptConfig = await ctx.prisma.llmPromptConfig.findUnique({
        where: { id: prompt.id },
        select: { copiedFromPromptId: true },
      });

      if (!promptConfig?.copiedFromPromptId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This prompt is not a copy and has no source to sync from",
        });
      }

      // Get the source prompt
      const sourcePromptRaw = await ctx.prisma.llmPromptConfig.findUnique({
        where: { id: promptConfig.copiedFromPromptId },
        include: {
          versions: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      if (!sourcePromptRaw || sourcePromptRaw.deletedAt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Source prompt has been deleted",
        });
      }

      if (!sourcePromptRaw.versions[0]) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Source prompt or its latest version not found",
        });
      }

      // Check permissions on source project
      const hasSourcePermission = await hasProjectPermission(
        ctx,
        sourcePromptRaw.projectId,
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
      const sourcePrompt = await service.getPromptByIdOrHandle({
        idOrHandle: sourcePromptRaw.id,
        projectId: sourcePromptRaw.projectId,
      });

      if (!sourcePrompt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Source prompt not found",
        });
      }

      // Normalize prompt/messages to avoid system prompt conflict
      const { normalizedPrompt, normalizedMessages } = normalizePromptData({
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
    .use(checkProjectPermission("prompts:update"))
    .mutation(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
      const authorId = ctx.session?.user?.id;

      // Get the source prompt
      const sourcePrompt = await service.getPromptByIdOrHandle({
        idOrHandle: input.idOrHandle,
        projectId: input.projectId,
      });

      if (!sourcePrompt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt not found",
        });
      }

      // Get copies using raw Prisma query
      const sourcePromptRaw = await ctx.prisma.llmPromptConfig.findUnique({
        where: { id: sourcePrompt.id },
        select: {
          id: true,
          handle: true,
          copiedPrompts: {
            where: { deletedAt: null },
            select: { id: true, projectId: true, handle: true },
          },
        },
      });

      if (!sourcePromptRaw) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Prompt not found",
        });
      }

      if (sourcePromptRaw.copiedPrompts.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This prompt has no copies to push to",
        });
      }

      // Filter copies if copyIds is provided
      const copiesToPush = input.copyIds
        ? sourcePromptRaw.copiedPrompts.filter((copy) =>
            input.copyIds!.includes(copy.id),
          )
        : sourcePromptRaw.copiedPrompts;

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
        const hasCopyPermission = await hasProjectPermission(
          ctx,
          copy.projectId,
          "prompts:update",
        );

        if (!hasCopyPermission) {
          // Skip copies where user doesn't have permission
          continue;
        }

        // Normalize prompt/messages to avoid system prompt conflict
        const { normalizedPrompt, normalizedMessages } = normalizePromptData({
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
        totalCopies: sourcePromptRaw.copiedPrompts.length,
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
    .use(checkProjectPermission("prompts:view"))
    .query(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
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
    .use(checkProjectPermission("prompts:update"))
    .mutation(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);

      try {
        return await service.assignTag({
          configId: input.configId,
          versionId: input.versionId,
          tag: input.tag,
          projectId: input.projectId,
          userId: ctx.session?.user?.id,
        });
      } catch (error) {
        if (error instanceof TagValidationError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
          });
        }
        throw error;
      }
    }),
});
