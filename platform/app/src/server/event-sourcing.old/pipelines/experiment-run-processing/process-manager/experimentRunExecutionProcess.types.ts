import { z } from "zod";

/** Process name, as mounted on the experiment-run pipeline. */
export const EXPERIMENT_RUN_EXECUTION_PROCESS_NAME = "experimentRunExecution";

export const EXPERIMENT_RUN_EXECUTION_INTENT_TYPES = {
  FAIL_RUN: "failRun",
} as const;

/**
 * How long an experiment run may produce nothing before it is declared dead.
 *
 * This bounds the gap between two consecutive per-cell events, **not** the
 * length of the run. `target_result` fires per (row, target) and
 * `evaluator_result` per (row, target, evaluator), so a ten-thousand-row run
 * emits tens of thousands of them; the window does not have to grow with the
 * dataset, only with the slowest single cell. With the default concurrency of
 * ten cells in flight, silence for a full window means ten cells stalled
 * simultaneously.
 *
 * Thirty minutes is a **heuristic, not a derivation**, and that is the honest
 * description of it. `scenarioExecution` can derive its window — 2× the
 * child-process cap — because a cap exists. Nothing bounds an experiment cell:
 * the only timeout anywhere in `experiments-v3` is the optional per-node
 * `config.timeoutMs` an HTTP node may carry. This value is 2× the only
 * comparable known bound in the codebase (`CHILD_PROCESS.TIMEOUT_MS`, 15
 * minutes), chosen so it is not tighter than the one execution cap the
 * platform does enforce elsewhere.
 *
 * It becomes a derivation the moment a per-cell execution cap exists — which
 * ADR-098 requires anyway as the precondition for leasing experiment work, and
 * at which point this should become `2 × EXPERIMENT_CELL_TIMEOUT_MS` exactly
 * as the scenario window is.
 */
export const EXPERIMENT_RUN_PROGRESS_DEADLINE_MS = 30 * 60 * 1000;

/**
 * Retries for the terminal-write intent. The write is idempotent — the
 * `completeExperimentRun` command carries a fixed idempotency key per run, so
 * a repeat collapses — and losing it would leave the run in exactly the
 * non-terminal state this process exists to prevent.
 */
export const EXPERIMENT_RUN_EXECUTION_MAX_ATTEMPTS = 3;

/** A terminal write is one command dispatch; it does not need a long lease. */
export const EXPERIMENT_RUN_EXECUTION_LEASE_DURATION_MS = 60_000;

/**
 * What a fired deadline records as the cause.
 *
 * A CODE, not a sentence: `runStateManager.failRun` stores this on the cached
 * run-state record and the run API serves it to the customer, and the platform-wide
 * handled-error migration (#6010) makes everything on that path a stable code
 * the frontend maps to copy. A prose message here would render raw.
 *
 * The run's stored terminal state still cannot carry a cause of its own (the
 * `completed` event models only `finishedAt`/`stoppedAt`), so the cached record
 * and the logs remain how a stall reaches a user.
 */
export const EXPERIMENT_RUN_STALLED_CODE = "lw.experiment_run_stalled";

export interface ExperimentRunExecutionState {
  /** Empty until the first event carrying identities is folded. */
  runId: string;
  experimentId: string;
  /** A terminal event arrived, or a wake wrote one. The deadline stays off. */
  settled: boolean;
}

export const INITIAL_EXPERIMENT_RUN_EXECUTION_STATE: ExperimentRunExecutionState =
  {
    runId: "",
    experimentId: "",
    settled: false,
  };

/**
 * The content boundary (ADR-098). Experiment-run events carry the customer's
 * dataset rows (`entry`), the model's outputs (`predicted`), evaluator inputs,
 * scores, labels and free-text failure details. The default `event.data`
 * payload would persist all of it verbatim into process state and outbox rows.
 * This process needs two identities and nothing else.
 */
export const experimentRunExecutionEventViewSchema = z.object({
  runId: z.string().nullable(),
  experimentId: z.string().nullable(),
});

export const experimentRunExecutionFailRunIntentSchema = z.object({
  projectId: z.string(),
  runId: z.string(),
  experimentId: z.string(),
  /** The instant the deadline fired; recorded as the run's terminal time. */
  stalledAt: z.number(),
  /**
   * The stable failure CODE, never prose. It reaches the customer through the
   * cached run record, where the frontend maps the code to copy; a sentence
   * here would render raw. See {@link EXPERIMENT_RUN_STALLED_CODE}.
   */
  code: z.string(),
});

export type ExperimentRunExecutionFailRunIntent = z.infer<
  typeof experimentRunExecutionFailRunIntentSchema
>;
