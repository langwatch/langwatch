import { openai } from "@ai-sdk/openai";
import { TRPCError } from "@trpc/server";
import { generateText } from "ai";
import { z } from "zod";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const translateRouter = createTRPCRouter({
  translate: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        textToTranslate: z.string(),
      }),
    )
    .use(checkProjectPermission("triggers:view"))
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
