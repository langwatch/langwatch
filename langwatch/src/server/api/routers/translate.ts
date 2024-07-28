import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";

import { openai } from "@ai-sdk/openai";
import { generateText } from "ai";

import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";

export const translateRouter = createTRPCRouter({
  translate: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        textToTranslate: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.TRIGGERS_MANAGE))
    .mutation(async ({ input }) => {
      try {
        const response: { text: string } = await generateText({
          model: openai("gpt-4-turbo"),
          prompt: `Translate the following text to English only reply with the translated text, do not include any other text: ${input.textToTranslate}`,
        });
        const { text } = response;
        return { translation: text };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get translation from OpenAI",
        });
      }
    }),
});
