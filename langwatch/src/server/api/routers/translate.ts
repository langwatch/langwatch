import { TRPCError } from "@trpc/server";
import { generateText } from "ai";
import { z } from "zod";
import { getVercelAIModel } from "../../modelProviders/utils";
import { createLogger } from "~/utils/logger/server";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const logger = createLogger("langwatch:translate");

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
        const model = await getVercelAIModel(input.projectId);
        const response: { text: string } = await generateText({
          model,
          prompt: `Translate the following text to English only reply with the translated text, do not include any other text: ${input.textToTranslate}`,
        });
        const { text } = response;
        return { translation: text };
      } catch (error) {
        logger.error(
          { error, projectId: input.projectId },
          "Failed to get translation",
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Failed to get translation. Check model provider configuration.",
          cause: error,
        });
      }
    }),
});
