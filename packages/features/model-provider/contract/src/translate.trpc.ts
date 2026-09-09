/**
 * The `translate.*` procedure, declared once. Owned by model-provider, not by
 * traces: the call only picks a model and reports failures; the text comes
 * from the caller.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

/**
 * A ceiling on the wire, not a product rule: past it the request is a paste of
 * something nobody is reading.
 */
export const TRANSLATE_TEXT_MAX_CHARS = 100_000;

export const translateTextInputSchema = z.object({
  projectId: z.string(),
  textToTranslate: z.string().max(TRANSLATE_TEXT_MAX_CHARS),
});

export const translateTextOutputSchema = z.object({ translation: z.string() });

export const translateTrpc = defineTrpcContract("translate")
  .mutation("translate")
  .withInput(translateTextInputSchema)
  .withOutput(translateTextOutputSchema)
  .build();
