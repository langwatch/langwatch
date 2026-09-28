/**
 * What the run's execution manager keeps, sees and asks for (ARCHITECTURE §9, D1, D4, D5): counts
 * and a finished-cell bitmap, never the plan, whose rows stay in `started` and the run's fold.
 */
import type { IntentSpec } from "@langwatch/eventing";
import { z } from "zod";

export const EXPERIMENT_RUN_EXECUTION_PROCESS_NAME = "experimentRunExecution";

/** A run with no finished cell for this long has lost its cells (precedent: scenario's stall). */
export const EXPERIMENT_RUN_STALL_MS = 15 * 60_000;

export const experimentRunExecutionStateSchema = z.object({
  status: z.enum(["idle", "running", "terminal"]),
  runId: z.string(),
  experimentId: z.string(),
  concurrency: z.number().int().nonnegative(),
  phaseOneCells: z.number().int().nonnegative(),
  phaseTwoCells: z.number().int().nonnegative(),
  /** The lowest ordinal not yet sent; every ordinal below it was sent or already finished. */
  nextOrdinal: z.number().int().nonnegative(),
  /** One bit per finished ordinal, base64. */
  finished: z.string(),
  aborting: z.boolean(),
  lastActivityAt: z.number(),
});

export type ExperimentRunExecutionState = z.infer<typeof experimentRunExecutionStateSchema>;

export const INITIAL_EXPERIMENT_RUN_EXECUTION_STATE: ExperimentRunExecutionState = {
  status: "idle",
  runId: "",
  experimentId: "",
  concurrency: 0,
  phaseOneCells: 0,
  phaseTwoCells: 0,
  nextOrdinal: 0,
  finished: "",
  aborting: false,
  lastActivityAt: 0,
};

/** The content boundary (ADR-052): the manager sees counts and identities, never a row. */
export const experimentRunExecutionViewSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("started"),
    runId: z.string(),
    experimentId: z.string(),
    /** Absent for a run started before runs carried a plan: folded, never driven. */
    window: z
      .object({
        concurrency: z.number().int().positive(),
        phaseOneCells: z.number().int().nonnegative(),
        phaseTwoCells: z.number().int().nonnegative(),
      })
      .nullable(),
  }),
  z.object({
    kind: z.literal("cell_finished"),
    ordinal: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal("abort_requested") }),
  z.object({ kind: z.literal("completed") }),
  z.object({ kind: z.literal("other") }),
]);

export type ExperimentRunExecutionView = z.infer<typeof experimentRunExecutionViewSchema>;

const cellIdentitySchema = z.object({
  runId: z.string(),
  experimentId: z.string(),
  ordinal: z.number().int().nonnegative(),
  phase: z.union([z.literal(1), z.literal(2)]),
});

/** One cell to execute: its ordinal and phase only (D4); the cell reads the rest from the fold. */
export const executeCellIntentSchema = cellIdentitySchema;

/** One cell the stall wake gives up on. */
export const failCellIntentSchema = cellIdentitySchema;

/** The run's end, once its last cell finished or, when stopping, its last cell in flight. */
export const completeRunIntentSchema = z.object({
  runId: z.string(),
  experimentId: z.string(),
  outcome: z.enum(["finished", "stopped"]),
});

export type ExecuteCellIntent = z.infer<typeof executeCellIntentSchema>;
export type FailCellIntent = z.infer<typeof failCellIntentSchema>;
export type CompleteRunIntent = z.infer<typeof completeRunIntentSchema>;

export type ExperimentRunExecutionIntents = {
  executeCell: IntentSpec<typeof executeCellIntentSchema>;
  failCell: IntentSpec<typeof failCellIntentSchema>;
  complete: IntentSpec<typeof completeRunIntentSchema>;
};
