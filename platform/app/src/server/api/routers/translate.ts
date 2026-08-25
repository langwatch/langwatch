import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { TRANSLATE_TEXT_MAX_CHARS } from "~/utils/constants";
import { wrapAiCall } from "../../modelProviders/aiCallFailedError";
import { featureByKey } from "../../modelProviders/featureRegistry";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const TRANSLATE_FEATURE_KEY = "translate.text";

export const translateRouter = createTRPCRouter({
  translate: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        textToTranslate: z.string().max(TRANSLATE_TEXT_MAX_CHARS),
      }),
    )
    // Translation reads content the caller can already see — gate on the
    // same permission that grants viewing the trace, so read-only members
    // (VIEWER, demo/public view) aren't shown an action that then 403s.
    .permission("traces:view")
    .mutation(async ({ input }) => {
      const feature = featureByKey(TRANSLATE_FEATURE_KEY);
      if (!feature) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `${TRANSLATE_FEATURE_KEY} feature is not registered`,
        });
      }

      // Any provider/SDK failure during the call surfaces as a typed
      // AiCallFailedError → "double-check your model configuration" toast
      // carrying the real (truncated) provider error message. wrapAiCall
      // truncates that message to the first line for the client, so log the
      // FULL underlying error server-side first — the later lines (provider
      // status bodies, gateway 404 detail) are what we need for prod triage.
      const { translation } = await wrapAiCall(feature, () =>
        ctx.app.modelProviders.translate({
          projectId: input.projectId,
          text: input.textToTranslate,
        }),
      );

      return { translation };
    }),
});
