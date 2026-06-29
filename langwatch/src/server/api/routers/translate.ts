import { TRPCError } from "@trpc/server";
import { generateText } from "ai";
import { z } from "zod";
import { wrapAiCall } from "../../modelProviders/aiCallFailedError";
import { featureByKey } from "../../modelProviders/featureRegistry";
import { getVercelAIModel } from "../../modelProviders/utils";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const TRANSLATE_FEATURE_KEY = "translate.text";

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
      const feature = featureByKey(TRANSLATE_FEATURE_KEY);
      if (!feature) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `${TRANSLATE_FEATURE_KEY} feature is not registered`,
        });
      }

      // Don't wrap everything in a generic INTERNAL_SERVER_ERROR — that
      // strips the typed `cause` the frontend needs and the user only ever
      // sees "please try again". Resolve the model OUTSIDE wrapAiCall: the
      // cascade resolver (resolveModelForFeature) throws the typed
      // ModelNotConfiguredError when nothing is set and
      // ModelProviderDisabledError when the resolved FAST model's provider
      // is disabled, and both must reach domainErrorMiddleware untouched to
      // open their own toasts. wrapAiCall only passes ModelNotConfiguredError
      // through, so resolving inside it would mis-tag a disabled provider as
      // an AI_CALL_FAILED.
      const model = await getVercelAIModel({
        projectId: input.projectId,
        featureKey: TRANSLATE_FEATURE_KEY,
      });

      // Any provider/SDK failure during the call surfaces as a typed
      // AiCallFailedError → "double-check your model configuration" toast
      // carrying the real (truncated) provider error message.
      const { text } = await wrapAiCall(feature, async () =>
        generateText({
          model,
          prompt: `Translate the following text to English only reply with the translated text, do not include any other text: ${input.textToTranslate}`,
        }),
      );

      return { translation: text };
    }),
});
