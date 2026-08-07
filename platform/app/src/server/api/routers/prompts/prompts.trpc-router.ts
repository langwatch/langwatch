import { PromptScope } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { afterPromptCreated } from "~/../ee/billing/nurturing/hooks/promptCreation";
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
import { hoistSystemMessage, PromptService } from "~/server/prompt-config";
import { TagValidationError } from "~/server/prompt-config/repositories/llm-config-tag.repository";
import { checkProjectPermission, hasProjectPermission } from "../../rbac";
import { createTRPCRouter, protectedProcedure } from "../../trpc";

type SyncSourcePrompt = NonNullable<
  Awaited<ReturnType<PromptService["getPromptByIdOrHandle"]>>
>;
type PromptUpdateData = Parameters<PromptService["updatePrompt"]>[0]["data"];

// Resolves the copy's source config, ensuring it's still a copy with a
// live, versioned source to sync from.
async function resolveSyncSourcePrompt({
  ctx,
  promptId,
}: {
  ctx: { prisma: ConstructorParameters<typeof PromptService>[0] };
  promptId: string;
}) {
  const promptConfig = await ctx.prisma.llmPromptConfig.findUnique({
    where: { id: promptId },
    select: { copiedFromPromptId: true },
  });

  if (!promptConfig?.copiedFromPromptId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This prompt is not a copy and has no source to sync from",
    });
  }

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

  return sourcePromptRaw;
}

async function assertSourcePromptViewPermission({
  ctx,
  sourceProjectId,
}: {
  ctx: Parameters<typeof hasProjectPermission>[0];
  sourceProjectId: string;
}) {
  const hasSourcePermission = await hasProjectPermission(
    ctx,
    sourceProjectId,
    "prompts:view",
  );

  if (!hasSourcePermission) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message:
        "You do not have permission to view prompts in the source project",
    });
  }
}

// Included only when defined, so a field the source never set doesn't
// clobber the target with an unintended null.
function includeIfDefined<K extends string, V>(
  key: K,
  value: V | null | undefined,
): Partial<Record<K, V>> {
  return value != null ? ({ [key]: value } as Record<K, V>) : {};
}

// The optional sampling / reasoning parameters, included only when the
// source actually set them.
function buildOptionalSamplingFields(sourcePrompt: SyncSourcePrompt) {
  return {
    ...includeIfDefined("maxTokens", sourcePrompt.maxTokens),
    // Traditional sampling parameters
    ...includeIfDefined("topP", sourcePrompt.topP),
    ...includeIfDefined("frequencyPenalty", sourcePrompt.frequencyPenalty),
    ...includeIfDefined("presencePenalty", sourcePrompt.presencePenalty),
    // Other sampling parameters
    ...includeIfDefined("seed", sourcePrompt.seed),
    ...includeIfDefined("topK", sourcePrompt.topK),
    ...includeIfDefined("minP", sourcePrompt.minP),
    ...includeIfDefined("repetitionPenalty", sourcePrompt.repetitionPenalty),
    // Reasoning parameter (canonical/unified field)
    ...includeIfDefined("reasoning", sourcePrompt.reasoning),
    ...includeIfDefined("verbosity", sourcePrompt.verbosity),
    ...includeIfDefined("promptingTechnique", sourcePrompt.promptingTechnique),
  };
}

// Normalizes prompt/messages to avoid a system-prompt conflict, then shapes
// the source's data into an update payload.
function buildSyncedPromptUpdateData({
  sourcePrompt,
  authorId,
}: {
  sourcePrompt: SyncSourcePrompt;
  authorId: string | undefined;
}): PromptUpdateData {
  const { prompt: normalizedPrompt, messages: normalizedMessages } =
    hoistSystemMessage({
      prompt: sourcePrompt.prompt,
      messages: sourcePrompt.messages,
    });

  return {
    commitMessage: `Updated from source prompt "${
      sourcePrompt.handle ?? sourcePrompt.id
    }"`,
    prompt: normalizedPrompt,
    messages: normalizedMessages,
    inputs: sourcePrompt.inputs,
    outputs: sourcePrompt.outputs,
    model: sourcePrompt.model,
    temperature: sourcePrompt.temperature,
    ...buildOptionalSamplingFields(sourcePrompt),
    demonstrations: sourcePrompt.demonstrations,
    parameters: sourcePrompt.parameters,
    authorId,
  };
}

// Resolves the copies to push to: the source's live copies, optionally
// narrowed to a caller-selected subset.
async function resolveCopiesToPush({
  ctx,
  sourcePromptId,
  copyIds,
}: {
  ctx: { prisma: ConstructorParameters<typeof PromptService>[0] };
  sourcePromptId: string;
  copyIds: string[] | undefined;
}) {
  const sourcePromptRaw = await ctx.prisma.llmPromptConfig.findUnique({
    where: { id: sourcePromptId },
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
    throw new TRPCError({ code: "NOT_FOUND", message: "Prompt not found" });
  }

  if (sourcePromptRaw.copiedPrompts.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This prompt has no copies to push to",
    });
  }

  const copiesToPush = copyIds
    ? sourcePromptRaw.copiedPrompts.filter((copy) => copyIds.includes(copy.id))
    : sourcePromptRaw.copiedPrompts;

  if (copiesToPush.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No valid copies selected to push to",
    });
  }

  return { sourcePromptRaw, copiesToPush };
}

// Normalizes prompt/messages to avoid a system-prompt conflict, then shapes
// the source's data into a push payload for one copy.
function buildPushedPromptUpdateData({
  sourcePrompt,
  authorId,
}: {
  sourcePrompt: SyncSourcePrompt;
  authorId: string | undefined;
}): PromptUpdateData {
  const { prompt: normalizedPrompt, messages: normalizedMessages } =
    hoistSystemMessage({
      prompt: sourcePrompt.prompt,
      messages: sourcePrompt.messages,
    });

  return {
    commitMessage: `Pushed from source prompt "${
      sourcePrompt.handle ?? sourcePrompt.id
    }"`,
    prompt: normalizedPrompt,
    messages: normalizedMessages,
    inputs: sourcePrompt.inputs,
    outputs: sourcePrompt.outputs,
    model: sourcePrompt.model,
    temperature: sourcePrompt.temperature,
    ...buildOptionalSamplingFields(sourcePrompt),
    demonstrations: sourcePrompt.demonstrations,
    parameters: sourcePrompt.parameters,
    ...includeIfDefined("responseFormat", sourcePrompt.responseFormat),
    authorId,
  };
}

// Pushes the source's data to one copy. Returns null (rather than throwing)
// when the caller lacks permission on the copy's project, so the caller can
// skip it and keep pushing to the rest.
async function pushPromptToCopy({
  ctx,
  service,
  copy,
  sourcePrompt,
  authorId,
}: {
  ctx: Parameters<typeof hasProjectPermission>[0];
  service: PromptService;
  copy: { id: string; projectId: string; handle: string | null };
  sourcePrompt: SyncSourcePrompt;
  authorId: string | undefined;
}) {
  const hasCopyPermission = await hasProjectPermission(
    ctx,
    copy.projectId,
    "prompts:update",
  );
  if (!hasCopyPermission) return null;

  const updated = await service.updatePrompt({
    idOrHandle: copy.id,
    projectId: copy.projectId,
    data: buildPushedPromptUpdateData({ sourcePrompt, authorId }),
  });

  return { copyId: copy.id, copyName: copy.handle ?? copy.id, prompt: updated };
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
    .use(checkProjectPermission("prompts:create"))
    .mutation(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
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

      const sourcePromptRaw = await resolveSyncSourcePrompt({
        ctx,
        promptId: prompt.id,
      });

      await assertSourcePromptViewPermission({
        ctx,
        sourceProjectId: sourcePromptRaw.projectId,
      });

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

      // Update the copy with source's data
      return await service.updatePrompt({
        idOrHandle: input.idOrHandle,
        projectId: input.projectId,
        data: buildSyncedPromptUpdateData({ sourcePrompt, authorId }),
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

      const { sourcePromptRaw, copiesToPush } = await resolveCopiesToPush({
        ctx,
        sourcePromptId: sourcePrompt.id,
        copyIds: input.copyIds,
      });

      const results = [];
      for (const copy of copiesToPush) {
        const pushed = await pushPromptToCopy({
          ctx,
          service,
          copy,
          sourcePrompt,
          authorId,
        });
        // Skip copies where the user doesn't have permission.
        if (pushed) results.push(pushed);
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
