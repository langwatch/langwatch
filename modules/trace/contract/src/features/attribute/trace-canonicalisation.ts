import type { Named } from "@langwatch/module";
import {
  canonicalAttributesSchema,
  canonicalEventSchema,
  canonicalSpanContextSchema,
} from "@langwatch/span-normalisation";
import { z } from "zod";

const canonicalizeSpanAttributesInputSchemaDefinition = z.object({
  spanAttributes: canonicalAttributesSchema,
  events: z.array(canonicalEventSchema),
  span: canonicalSpanContextSchema,
});
export interface CanonicalizeSpanAttributesInputSchema extends Named<
  typeof canonicalizeSpanAttributesInputSchemaDefinition
> {}
export const canonicalizeSpanAttributesInputSchema: CanonicalizeSpanAttributesInputSchema =
  canonicalizeSpanAttributesInputSchemaDefinition;

const canonicalizeSpanAttributesResultSchemaDefinition = z.object({
  attributes: canonicalAttributesSchema,
  events: z.array(canonicalEventSchema),
  appliedRules: z.array(z.string()),
});
export interface CanonicalizeSpanAttributesResultSchema extends Named<
  typeof canonicalizeSpanAttributesResultSchemaDefinition
> {}
export const canonicalizeSpanAttributesResultSchema: CanonicalizeSpanAttributesResultSchema =
  canonicalizeSpanAttributesResultSchemaDefinition;

const canonicalizeLogRecordInputSchemaDefinition = z.object({
  scopeName: z.string(),
  body: z.string(),
  attributes: canonicalAttributesSchema,
});
export interface CanonicalizeLogRecordInputSchema extends Named<
  typeof canonicalizeLogRecordInputSchemaDefinition
> {}
export const canonicalizeLogRecordInputSchema: CanonicalizeLogRecordInputSchema =
  canonicalizeLogRecordInputSchemaDefinition;

const canonicalizeLogRecordResultSchemaDefinition = z.object({
  attributes: canonicalAttributesSchema,
  appliedRules: z.array(z.string()),
});
export interface CanonicalizeLogRecordResultSchema extends Named<
  typeof canonicalizeLogRecordResultSchemaDefinition
> {}
export const canonicalizeLogRecordResultSchema: CanonicalizeLogRecordResultSchema =
  canonicalizeLogRecordResultSchemaDefinition;

const extractMessageTextInputSchemaDefinition = z.object({
  value: z.unknown(),
  mode: z.enum(["input", "output"]),
});
export interface ExtractMessageTextInputSchema extends Named<
  typeof extractMessageTextInputSchemaDefinition
> {}
export const extractMessageTextInputSchema: ExtractMessageTextInputSchema =
  extractMessageTextInputSchemaDefinition;

export const extractMessageTextResultSchema = z.string().nullable();

const canonicalMessageSchema = z.object({
  role: z.string(),
  content: z.string(),
});

const claudeToolResultSchema = z.object({
  useId: z.string(),
  text: z.string(),
});

const deriveClaudeRequestContentInputSchemaDefinition = z.object({
  body: z.unknown(),
});
export interface DeriveClaudeRequestContentInputSchema extends Named<
  typeof deriveClaudeRequestContentInputSchemaDefinition
> {}
export const deriveClaudeRequestContentInputSchema: DeriveClaudeRequestContentInputSchema =
  deriveClaudeRequestContentInputSchemaDefinition;

const deriveClaudeRequestContentResultSchemaDefinition = z.object({
  messages: z.array(canonicalMessageSchema).nullable(),
  toolResults: z.array(claudeToolResultSchema),
});
export interface DeriveClaudeRequestContentResultSchema extends Named<
  typeof deriveClaudeRequestContentResultSchemaDefinition
> {}
export const deriveClaudeRequestContentResultSchema: DeriveClaudeRequestContentResultSchema =
  deriveClaudeRequestContentResultSchemaDefinition;

const deriveClaudeResponseContentInputSchemaDefinition = z.object({
  body: z.unknown(),
});
export interface DeriveClaudeResponseContentInputSchema extends Named<
  typeof deriveClaudeResponseContentInputSchemaDefinition
> {}
export const deriveClaudeResponseContentInputSchema: DeriveClaudeResponseContentInputSchema =
  deriveClaudeResponseContentInputSchemaDefinition;

const deriveClaudeResponseContentResultSchemaDefinition = z.object({
  assistantText: z.string().nullable(),
  assistantOutput: z.string().nullable(),
  sessionTitle: z.string().nullable(),
});
export interface DeriveClaudeResponseContentResultSchema extends Named<
  typeof deriveClaudeResponseContentResultSchemaDefinition
> {}
export const deriveClaudeResponseContentResultSchema: DeriveClaudeResponseContentResultSchema =
  deriveClaudeResponseContentResultSchemaDefinition;

const classifyClaudeCallInputSchemaDefinition = z.object({
  querySource: z.string().nullable(),
  llmRequestContext: z.string().nullish(),
});
export interface ClassifyClaudeCallInputSchema extends Named<
  typeof classifyClaudeCallInputSchemaDefinition
> {}
export const classifyClaudeCallInputSchema: ClassifyClaudeCallInputSchema =
  classifyClaudeCallInputSchemaDefinition;

const classifyClaudeCallResultSchemaDefinition = z.object({
  conversational: z.boolean(),
  cacheWritesLongLived: z.boolean(),
});
export interface ClassifyClaudeCallResultSchema extends Named<
  typeof classifyClaudeCallResultSchemaDefinition
> {}
export const classifyClaudeCallResultSchema: ClassifyClaudeCallResultSchema =
  classifyClaudeCallResultSchemaDefinition;

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
 * Trace's portable deterministic canonicalisation boundary. Log and metric
 * preparation have separate ownership; this receives only the stable
 * operations needed to interpret a span and its correlated records.
 */
export abstract class TraceCanonicalisationService {
  abstract canonicalizeSpanAttributes(
    input: CanonicalizeSpanAttributesInput,
  ): CanonicalizeSpanAttributesResult;

  abstract canonicalizeLogRecord(input: CanonicalizeLogRecordInput): CanonicalizeLogRecordResult;

  abstract extractMessageText(input: ExtractMessageTextInput): string | null;

  abstract deriveClaudeRequestContent(
    input: DeriveClaudeRequestContentInput,
  ): DeriveClaudeRequestContentResult;

  abstract deriveClaudeResponseContent(
    input: DeriveClaudeResponseContentInput,
  ): DeriveClaudeResponseContentResult;

  abstract classifyClaudeCall(input: ClassifyClaudeCallInput): ClassifyClaudeCallResult;
}
