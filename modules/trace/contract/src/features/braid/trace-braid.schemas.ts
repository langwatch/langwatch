/**
 * The braid dialog's and the Braids page's reads (ADR-183 §7): the preview counts, the
 * owner's attribute keys, each braid's activity and one test trace as the reader sees it.
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

import { spanTreeNodeSchema } from "../../trace.ts";

/** The longest condition text a preview takes; the compiler refuses far shorter ones by name. */
export const BRAID_PREVIEW_WHERE_MAX_LENGTH = 16_384;
/** The most braids one activity read counts. */
export const BRAID_ACTIVITY_IDS_MAX = 500;

/** The draft braid both the preview and the test trace read against. */
const braidDraftShape = {
  /** The owner: the project whose spans the braid shares. */
  projectId: z.string(),
  readerProjectId: z.string(),
  where: z.string().max(BRAID_PREVIEW_WHERE_MAX_LENGTH).optional(),
  fromMs: z.number(),
  /** The braid being edited, which the draft replaces; absent for a new braid. */
  braidId: z.string().optional(),
} as const;

const braidPreviewInputSchemaDefinition = z.object(braidDraftShape);
export interface BraidPreviewInputSchema extends Named<typeof braidPreviewInputSchemaDefinition> {}
export const braidPreviewInputSchema: BraidPreviewInputSchema = braidPreviewInputSchemaDefinition;
export type BraidPreviewInput = z.infer<typeof braidPreviewInputSchema>;

/** A condition the compiler refused: the message, the construct, its offset and the fix. */
const braidConditionRefusalViewSchemaDefinition = z.object({
  message: z.string(),
  at: z.number().int().min(0),
  construct: z.string(),
  fix: z.string(),
});
export interface BraidConditionRefusalViewSchema extends Named<
  typeof braidConditionRefusalViewSchemaDefinition
> {}
export const braidConditionRefusalViewSchema: BraidConditionRefusalViewSchema =
  braidConditionRefusalViewSchemaDefinition;
export type BraidConditionRefusalView = z.infer<typeof braidConditionRefusalViewSchema>;

/** The reader's traces by how many of their owner spans match; `capped` past the trace cap. */
const braidPreviewTracesSchemaDefinition = z.object({
  every: z.number().int().min(0),
  some: z.number().int().min(0),
  none: z.number().int().min(0),
  total: z.number().int().min(0),
  capped: z.boolean(),
});
export interface BraidPreviewTracesSchema extends Named<
  typeof braidPreviewTracesSchemaDefinition
> {}
export const braidPreviewTracesSchema: BraidPreviewTracesSchema =
  braidPreviewTracesSchemaDefinition;

const braidAttributeKeysInputSchemaDefinition = z.object({ projectId: z.string() });
export interface BraidAttributeKeysInputSchema extends Named<
  typeof braidAttributeKeysInputSchemaDefinition
> {}
export const braidAttributeKeysInputSchema: BraidAttributeKeysInputSchema =
  braidAttributeKeysInputSchemaDefinition;

/** The owner's span attribute keys over the last 7 days, most frequent first. */
const braidAttributeKeysSchemaDefinition = z.object({
  keys: z.array(z.object({ key: z.string(), spanCount: z.number().int().min(0) })),
});
export interface BraidAttributeKeysSchema extends Named<
  typeof braidAttributeKeysSchemaDefinition
> {}
export const braidAttributeKeysSchema: BraidAttributeKeysSchema =
  braidAttributeKeysSchemaDefinition;
export type BraidAttributeKeys = z.infer<typeof braidAttributeKeysSchema>;

const braidActivityInputSchemaDefinition = z.object({
  projectId: z.string(),
  braidIds: z.array(z.string()).max(BRAID_ACTIVITY_IDS_MAX),
});
export interface BraidActivityInputSchema extends Named<
  typeof braidActivityInputSchemaDefinition
> {}
export const braidActivityInputSchema: BraidActivityInputSchema =
  braidActivityInputSchemaDefinition;
export type BraidActivityInput = z.infer<typeof braidActivityInputSchema>;

/** Each braid's spans in the last 24 hours, counted for the page's own project. */
const braidActivitySchemaDefinition = z.object({
  activity: z.array(z.object({ braidId: z.string(), spanCount: z.number().int().min(0) })),
});
export interface BraidActivitySchema extends Named<typeof braidActivitySchemaDefinition> {}
export const braidActivitySchema: BraidActivitySchema = braidActivitySchemaDefinition;
export type BraidActivity = z.infer<typeof braidActivitySchema>;

const braidTestTraceInputSchemaDefinition = z.object({ ...braidDraftShape, traceId: z.string() });
export interface BraidTestTraceInputSchema extends Named<
  typeof braidTestTraceInputSchemaDefinition
> {}
export const braidTestTraceInputSchema: BraidTestTraceInputSchema =
  braidTestTraceInputSchemaDefinition;
export type BraidTestTraceInput = z.infer<typeof braidTestTraceInputSchema>;

/** An owner span carries `ownerProjectId` and whether a live braid or the draft lets it through. */
const braidTestTraceNodeSchemaDefinition = z.object({
  ...spanTreeNodeSchema.shape,
  braided: z.boolean().optional(),
});
export interface BraidTestTraceNodeSchema extends Named<
  typeof braidTestTraceNodeSchemaDefinition
> {}
export const braidTestTraceNodeSchema: BraidTestTraceNodeSchema =
  braidTestTraceNodeSchemaDefinition;
export type BraidTestTraceNode = z.infer<typeof braidTestTraceNodeSchema>;

/** A trace the reader does not hold is `found: false` with no nodes. */
const braidTestTraceSchemaDefinition = z.object({
  found: z.boolean(),
  nodes: z.array(braidTestTraceNodeSchema),
});
export interface BraidTestTraceSchema extends Named<typeof braidTestTraceSchemaDefinition> {}
export const braidTestTraceSchema: BraidTestTraceSchema = braidTestTraceSchemaDefinition;
export type BraidTestTrace = z.infer<typeof braidTestTraceSchema>;

/** The pair's live braids alone, the draft left out: how many, and what they show. */
const braidPreviewLiveSchemaDefinition = z.object({
  braids: z.number().int().min(0),
  traces: braidPreviewTracesSchema,
  spans: z.number().int().min(0),
});
export interface BraidPreviewLiveSchema extends Named<typeof braidPreviewLiveSchemaDefinition> {}
export const braidPreviewLiveSchema: BraidPreviewLiveSchema = braidPreviewLiveSchemaDefinition;

/** The newest counted trace that gets a braided span, rendered as Test a trace renders one. */
const braidPreviewExampleSchemaDefinition = z.object({
  traceId: z.string(),
  nodes: z.array(braidTestTraceNodeSchema),
});
export interface BraidPreviewExampleSchema extends Named<
  typeof braidPreviewExampleSchemaDefinition
> {}
export const braidPreviewExampleSchema: BraidPreviewExampleSchema =
  braidPreviewExampleSchemaDefinition;

/**
 * `traces` and `spans`: what the reader sees with the pair's live braids and the draft together;
 * `live`: the same without the draft. `unsignedHidden`: spans held back only by `Verified(...)`,
 * null when the condition has none. `example`: null when no counted trace gets a braided span.
 */
const braidPreviewSchemaDefinition = z.object({
  refusal: braidConditionRefusalViewSchema.nullable(),
  traces: braidPreviewTracesSchema,
  spans: z.number().int().min(0),
  live: braidPreviewLiveSchema,
  unsignedHidden: z.number().int().min(0).nullable(),
  example: braidPreviewExampleSchema.nullable(),
});
export interface BraidPreviewSchema extends Named<typeof braidPreviewSchemaDefinition> {}
export const braidPreviewSchema: BraidPreviewSchema = braidPreviewSchemaDefinition;
export type BraidPreview = z.infer<typeof braidPreviewSchema>;
