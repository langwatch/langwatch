/**
 * What the trace feature's tRPC transports answer, stated once.
 *
 * The chain declares each procedure's `withOutput` from here, so the shape a
 * client reads is written down in the contract rather than implied by
 * whatever a handler happened to return. The schemas are checked against
 * real answers in development and test; production returns the handler's
 * own value.
 */
import { z } from "zod";
import { traceEditOverlayPatchSchema } from "./trace-edit-overlay.contract";
import {
  chatMessageSchema,
  errorCaptureSchema,
  langWatchSpanSchema,
  spanMetricsSchema,
  spanTimestampsSchema,
} from "./trace-format.schemas";

const traceEditOverlayAuthorSchema = z
  .object({ id: z.string(), name: z.string().nullable(), image: z.string().nullable() })
  .strict();

/** One trace's stored correction, as every reader of it receives it. */
export const traceEditOverlayDtoSchema = z
  .object({
    traceId: z.string(),
    patch: traceEditOverlayPatchSchema,
    createdBy: traceEditOverlayAuthorSchema.nullable(),
    updatedBy: traceEditOverlayAuthorSchema.nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

/** `getByTraceId`: no correction stored yet answers `null`, not a 404. */
export const traceEditOverlayOrNullSchema = traceEditOverlayDtoSchema.nullable();

/** One trace's spans, in the waterfall order the application resolved. */
export const spansForTraceSchema = z.array(langWatchSpanSchema);

/** One LLM span reshaped for the prompt studio. */
export const promptStudioSpanSchema = z
  .object({
    spanId: z.string(),
    traceId: z.string(),
    spanName: z.string().nullable(),
    messages: z.array(chatMessageSchema),
    llmConfig: z
      .object({
        model: z.string().nullable(),
        systemPrompt: chatMessageSchema.shape.content,
        temperature: z.number().nullable(),
        maxTokens: z.number().nullable(),
        topP: z.number().nullable(),
        frequencyPenalty: z.number().nullable(),
        presencePenalty: z.number().nullable(),
        seed: z.number().nullable(),
        topK: z.number().nullable(),
        minP: z.number().nullable(),
        repetitionPenalty: z.number().nullable(),
        reasoning: z.string().nullable(),
        verbosity: z.string().nullable(),
        litellmParams: z.record(z.string(), z.unknown()),
      })
      .strict(),
    vendor: z.string().nullable(),
    error: errorCaptureSchema.nullable(),
    timestamps: spanTimestampsSchema.optional(),
    metrics: spanMetricsSchema.nullable(),
    promptHandle: z.string().nullable(),
    promptVersionNumber: z.number().nullable(),
    promptTag: z.string().nullable(),
    promptVariables: z.record(z.string(), z.string()).nullable(),
  })
  .strict();
