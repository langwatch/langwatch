import { z } from "zod";

export const canonicalAttributesSchema = z.record(z.string(), z.unknown());

export const canonicalEventSchema = z.object({
  name: z.string(),
  timeUnixMs: z.number(),
  attributes: canonicalAttributesSchema,
});

export const canonicalSpanContextSchema = z.object({
  name: z.string(),
  kind: z.union([z.number(), z.string(), z.null()]),
  instrumentationScope: z.object({
    name: z.string(),
    version: z.string().nullish(),
  }),
  statusMessage: z.string().nullable(),
  statusCode: z.number().nullable(),
  parentSpanId: z.string().nullable(),
});

export const canonicalizeSpanAttributesInputSchema = z.object({
  spanAttributes: canonicalAttributesSchema,
  events: z.array(canonicalEventSchema),
  span: canonicalSpanContextSchema,
});

export const canonicalizeSpanAttributesResultSchema = z.object({
  attributes: canonicalAttributesSchema,
  events: z.array(canonicalEventSchema),
  appliedRules: z.array(z.string()),
});

export const canonicalizeLogRecordInputSchema = z.object({
  scopeName: z.string(),
  body: z.string(),
  attributes: canonicalAttributesSchema,
});

export const canonicalizeLogRecordResultSchema = z.object({
  attributes: canonicalAttributesSchema,
  appliedRules: z.array(z.string()),
});

export const extractMessageTextInputSchema = z.object({
  value: z.unknown(),
  mode: z.enum(["input", "output"]),
});

export const extractMessageTextResultSchema = z.string().nullable();

const canonicalMessageSchema = z.object({
  role: z.string(),
  content: z.string(),
});

const claudeToolResultSchema = z.object({
  useId: z.string(),
  text: z.string(),
});

export const deriveClaudeRequestContentInputSchema = z.object({
  body: z.unknown(),
});

export const deriveClaudeRequestContentResultSchema = z.object({
  messages: z.array(canonicalMessageSchema).nullable(),
  toolResults: z.array(claudeToolResultSchema),
});

export const deriveClaudeResponseContentInputSchema = z.object({
  body: z.unknown(),
});

export const deriveClaudeResponseContentResultSchema = z.object({
  assistantText: z.string().nullable(),
  assistantOutput: z.string().nullable(),
  sessionTitle: z.string().nullable(),
});

export const classifyClaudeCallInputSchema = z.object({
  querySource: z.string().nullable(),
  llmRequestContext: z.string().nullish(),
});

export const classifyClaudeCallResultSchema = z.object({
  conversational: z.boolean(),
  cacheWritesLongLived: z.boolean(),
});

export type CanonicalAttributes = z.infer<typeof canonicalAttributesSchema>;
export type CanonicalEvent = z.infer<typeof canonicalEventSchema>;
export type CanonicalSpanContext = z.infer<typeof canonicalSpanContextSchema>;
export type CanonicalizeSpanAttributesInput = z.infer<typeof canonicalizeSpanAttributesInputSchema>;
export type CanonicalizeSpanAttributesResult = z.infer<
  typeof canonicalizeSpanAttributesResultSchema
>;
export type CanonicalizeLogRecordInput = z.infer<typeof canonicalizeLogRecordInputSchema>;
export type CanonicalizeLogRecordResult = z.infer<typeof canonicalizeLogRecordResultSchema>;
export type ExtractMessageTextInput = z.infer<typeof extractMessageTextInputSchema>;
export type DeriveClaudeRequestContentInput = z.infer<typeof deriveClaudeRequestContentInputSchema>;
export type DeriveClaudeRequestContentResult = z.infer<
  typeof deriveClaudeRequestContentResultSchema
>;
export type DeriveClaudeResponseContentInput = z.infer<
  typeof deriveClaudeResponseContentInputSchema
>;
export type DeriveClaudeResponseContentResult = z.infer<
  typeof deriveClaudeResponseContentResultSchema
>;
export type ClassifyClaudeCallInput = z.infer<typeof classifyClaudeCallInputSchema>;
export type ClassifyClaudeCallResult = z.infer<typeof classifyClaudeCallResultSchema>;

/**
 * Trace's portable deterministic canonicalisation boundary.
 *
 * Log and metric preparation have separate ownership. Trace projections only
 * receive the stable operations needed to interpret a trace span and its
 * correlated records.
 */
export abstract class TraceCanonicalisationService {
  abstract canonicalizeSpanAttributes(
    input: CanonicalizeSpanAttributesInput,
  ): CanonicalizeSpanAttributesResult;

  abstract canonicalizeLogRecord(input: CanonicalizeLogRecordInput): CanonicalizeLogRecordResult;

  abstract tryExtractMessageText(input: ExtractMessageTextInput): string | null;

  abstract deriveClaudeRequestContent(
    input: DeriveClaudeRequestContentInput,
  ): DeriveClaudeRequestContentResult;

  abstract deriveClaudeResponseContent(
    input: DeriveClaudeResponseContentInput,
  ): DeriveClaudeResponseContentResult;

  abstract classifyClaudeCall(input: ClassifyClaudeCallInput): ClassifyClaudeCallResult;
}
