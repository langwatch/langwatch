/**
 * The `translate.*` procedure, declared once. Owned by model-provider, not by
 * traces: the call only picks a model and reports failures; the text comes
 * from the caller.
 */
import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

/**
 * A ceiling on the wire, not a product rule: past it the request is a paste of
 * something nobody is reading.
 */
export const TRANSLATE_TEXT_MAX_CHARS = 100_000;

const translateTextInputSchemaDefinition = z.object({
  projectId: z.string(),
  textToTranslate: z.string().max(TRANSLATE_TEXT_MAX_CHARS),
});
export interface TranslateTextInputSchema extends Named<
  typeof translateTextInputSchemaDefinition
> {}
export const translateTextInputSchema: TranslateTextInputSchema =
  translateTextInputSchemaDefinition;

const translateTextOutputSchemaDefinition = z.object({ translation: z.string() });
export interface TranslateTextOutputSchema extends Named<
  typeof translateTextOutputSchemaDefinition
> {}
export const translateTextOutputSchema: TranslateTextOutputSchema =
  translateTextOutputSchemaDefinition;

export const translateTrpc = defineTrpcContract("translate")
  .mutation("translate")
  .withInput(translateTextInputSchema)
  .withOutput(translateTextOutputSchema)
  .build();
