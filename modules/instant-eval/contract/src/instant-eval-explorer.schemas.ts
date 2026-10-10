import type { Named } from "@langwatch/module";
/**
 * What the Explorer asks an Instant Eval run for, and the counters a chip
 * reads back. It sends the search bar's vocabulary and the shorthand writes
 * the statement, so this is the run a CLI caller starts with `--target`.
 */
import { z } from "zod";

import { INSTANT_EVAL_TARGETS } from "./instant-eval-limits.ts";
import { instantEvalRunSchema } from "./instant-eval.schemas.ts";

/**
 * Epoch milliseconds a `Date` can represent. Past this, writing the bound as
 * an instant raises, which would reach the caller as an internal error rather
 * than as the validation failure it is.
 */
const EPOCH_MS = z.number().int().min(-8_640_000_000_000_000).max(8_640_000_000_000_000);

/** What the Explorer asks to judge: the shorthand, in the search bar's words. */
const explorerInstantEvalRunSchemaDefinition = z.object({
  projectId: z.string(),
  target: z.enum(INSTANT_EVAL_TARGETS),
  /** The other chips of the query, as the filter narrowing what is judged. */
  filter: z.string().max(4_000).default(""),
  /** The exact bounds the search ran in, frozen for the run's life. */
  window: z.object({ from: EPOCH_MS, to: EPOCH_MS }),
  question: z.object({
    instructions: z.string().min(1).max(2_000),
    /** What counts as yes, then what counts as no. */
    criteria: z.tuple([z.string().min(1).max(500), z.string().min(1).max(500)]).optional(),
  }),
  /** Rows the run may judge. Absent means the default cap. */
  limit: z.number().int().positive().optional(),
});
export interface ExplorerInstantEvalRunSchema extends Named<
  typeof explorerInstantEvalRunSchemaDefinition
> {}
export const explorerInstantEvalRunSchema: ExplorerInstantEvalRunSchema =
  explorerInstantEvalRunSchemaDefinition;

export type ExplorerInstantEvalRunInput = z.infer<typeof explorerInstantEvalRunSchema>;

/** The project the opt-in popover was opened in; its organization is resolved, never taken. */
const explorerInstantEvalProjectSchemaDefinition = z.object({ projectId: z.string() });
export interface ExplorerInstantEvalProjectSchema extends Named<
  typeof explorerInstantEvalProjectSchemaDefinition
> {}
export const explorerInstantEvalProjectSchema: ExplorerInstantEvalProjectSchema =
  explorerInstantEvalProjectSchemaDefinition;

/** One run of this project, named. */
const explorerInstantEvalRunIdSchemaDefinition = z.object({
  projectId: z.string(),
  runId: z.string().min(1).max(200),
});
export interface ExplorerInstantEvalRunIdSchema extends Named<
  typeof explorerInstantEvalRunIdSchemaDefinition
> {}
export const explorerInstantEvalRunIdSchema: ExplorerInstantEvalRunIdSchema =
  explorerInstantEvalRunIdSchemaDefinition;

/** The run's counters, which is all a chip and a progress bar read. */
const explorerInstantEvalProgressSchemaDefinition = z.object({
  ...instantEvalRunSchema.pick({
    id: true,
    status: true,
    total: true,
    progress: true,
    matched: true,
    failed: true,
    skipped: true,
    error: true,
    priceUsd: true,
  }).shape,
  finishedAtMs: z
    .number()
    .nullable()
    .describe("When the run ended, in epoch milliseconds. Null until it has."),
});
export interface ExplorerInstantEvalProgressSchema extends Named<
  typeof explorerInstantEvalProgressSchemaDefinition
> {}
export const explorerInstantEvalProgressSchema: ExplorerInstantEvalProgressSchema =
  explorerInstantEvalProgressSchemaDefinition;

export type ExplorerInstantEvalProgress = z.infer<typeof explorerInstantEvalProgressSchema>;

/**
 * A search-bar sentence, with the context the routing classifier reads it in.
 * Plain fields of this module's own, so no trace type crosses (T2 D3, 2026-10-08).
 */
const explorerSearchClassificationInputSchemaDefinition = z.object({
  projectId: z.string(),
  /** The whole submitted text: bare words plus any explicit terms. */
  text: z.string().min(1).max(2_000),
  timeRange: z.object({ from: EPOCH_MS, to: EPOCH_MS }),
  /** The query applied before this submit, for context only. */
  activeQuery: z.string().max(2_000).optional(),
  lensId: z.string().max(200).optional(),
  /** Whether the assistant route is open to this user. Absent means it is. */
  isLangyAvailable: z.boolean().optional(),
});
export interface ExplorerSearchClassificationInputSchema extends Named<
  typeof explorerSearchClassificationInputSchemaDefinition
> {}
export const explorerSearchClassificationInputSchema: ExplorerSearchClassificationInputSchema =
  explorerSearchClassificationInputSchemaDefinition;

export type ExplorerSearchClassificationInput = z.infer<
  typeof explorerSearchClassificationInputSchema
>;

/** The route label the classifier answered, if any, and whether a judgement may be offered. */
const explorerSearchClassificationSchemaDefinition = z.object({
  classified: z.string().nullable(),
  isInstantEvalAvailable: z.boolean(),
});
export interface ExplorerSearchClassificationSchema extends Named<
  typeof explorerSearchClassificationSchemaDefinition
> {}
export const explorerSearchClassificationSchema: ExplorerSearchClassificationSchema =
  explorerSearchClassificationSchemaDefinition;

export type ExplorerSearchClassification = z.infer<typeof explorerSearchClassificationSchema>;
