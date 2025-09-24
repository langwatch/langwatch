import { PromptScope } from "@prisma/client";
import { z } from "zod";

import { PromptService } from "~/server/prompt-config";
import { getLatestConfigVersionSchema } from "~/server/prompt-config/repositories/llm-config-version-schema";

import { TeamRoleGroup } from "../../permission";
import { checkUserPermissionForProject } from "../../permission";
import { createTRPCRouter, protectedProcedure } from "../../trpc";

import { handleSchema } from "~/prompt-configs/schemas";

/**
 * Router for handling prompts - the business-facing interface
 * Currently only supports upsert operation
 * TODO: Add other operations as needed
 */
export const promptsRouter = createTRPCRouter({
  /**
   * Upsert a prompt - create if it doesn't exist, update if it does
   */
  upsert: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        promptId: z.string().optional(),
        handle: handleSchema,
        scope: z.nativeEnum(PromptScope).optional(),
        commitMessage: z.string().optional(),
        versionData: getLatestConfigVersionSchema().shape.configData.partial(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.PROMPTS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const service = new PromptService(ctx.prisma);
      const authorId = ctx.session?.user?.id;

      return await service.upsertPrompt({
        idOrHandle: input.promptId,
        projectId: input.projectId,
        handle: input.handle,
        scope: input.scope,
        authorId,
        commitMessage: input.commitMessage,
        versionData: input.versionData,
      });
    }),
});