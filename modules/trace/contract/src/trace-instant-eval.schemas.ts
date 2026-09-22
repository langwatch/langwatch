/**
 * What the Explorer asks an Instant Eval run for, and the counters a chip
 * reads back. It sends the search bar's vocabulary and the shorthand writes
 * the statement, so this is the run a CLI caller starts with `--target`.
 */
import { INSTANT_EVAL_TARGETS, instantEvalRunSchema } from "@langwatch/instant-eval-contract";
import { z } from "zod";

/**
 * Epoch milliseconds a `Date` can represent. Past this, writing the bound as
 * an instant raises, which would reach the caller as an internal error rather
 * than as the validation failure it is.
 */
const EPOCH_MS = z.number().int().min(-8_640_000_000_000_000).max(8_640_000_000_000_000);

/** What the Explorer asks to judge: the shorthand, in the search bar's words. */
export const explorerInstantEvalRunSchema = z.object({
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

export type ExplorerInstantEvalRunInput = z.infer<typeof explorerInstantEvalRunSchema>;

/** One run of this project, named. */
export const explorerInstantEvalRunIdSchema = z.object({
  projectId: z.string(),
  runId: z.string().min(1).max(200),
});

/** The run's counters, which is all a chip and a progress bar read. */
export const explorerInstantEvalProgressSchema = z.object({
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

export type ExplorerInstantEvalProgress = z.infer<typeof explorerInstantEvalProgressSchema>;
