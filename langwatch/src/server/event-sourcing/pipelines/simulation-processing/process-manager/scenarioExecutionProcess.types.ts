import { z } from "zod";

import { CHILD_PROCESS } from "~/server/scenarios/scenario.constants";

/** Process name, as mounted on the simulation pipeline. */
export const SCENARIO_EXECUTION_PROCESS_NAME = "scenarioExecution";

export const SCENARIO_EXECUTION_INTENT_TYPES = {
  FAIL_RUN: "failRun",
} as const;

/**
 * How long a run may go quiet before it is declared dead.
 *
 * 2× the child-process timeout, which is the same bound the read-time
 * `STALLED` derivation and both deleted boot sweeps used. A child that hits
 * its own 15-minute cap still has a full cap's worth of margin to report the
 * failure itself, so this deadline only fires when nothing is left to report
 * it — which is exactly the case it exists for.
 */
export const SCENARIO_PROGRESS_DEADLINE_MS = CHILD_PROCESS.TIMEOUT_MS * 2;

/**
 * How long a run may sit queued before it is declared undispatched.
 *
 * Deliberately the same bound. Queue wait is not evidence of worker death —
 * nothing bounds how long a large batch queues behind its own siblings — so
 * this is set generously rather than tuned to dispatch latency.
 */
export const SCENARIO_DISPATCH_DEADLINE_MS = CHILD_PROCESS.TIMEOUT_MS * 2;

/**
 * How long a cancel may take to be honoured before the run is finalised as
 * cancelled anyway.
 *
 * Short, because cancellation is a Redis broadcast to a live child: either a
 * worker holds the child and SIGTERMs it within seconds, or no worker holds
 * it and no amount of waiting will produce a terminal event.
 */
export const SCENARIO_CANCEL_DEADLINE_MS = 60_000;

/**
 * Retries for the terminal-write intent. `finishRun` is idempotent, so a
 * retried write is harmless — and losing it would leave the run in exactly
 * the non-terminal state this process exists to prevent.
 *
 * This is not the scenario's own no-retry contract: nothing is re-executed
 * here, only the record of its death is written.
 */
export const SCENARIO_EXECUTION_MAX_ATTEMPTS = 3;

/** A terminal write is one command dispatch; it does not need a long lease. */
export const SCENARIO_EXECUTION_LEASE_DURATION_MS = 60_000;

export interface ScenarioExecutionState {
  /** Empty until the first event carrying identities is folded. */
  scenarioRunId: string;
  scenarioId: string;
  batchRunId: string;
  setId: string;
  /**
   * A cancel was asked for. Decides which terminal status a fired deadline
   * writes — a run the user cancelled is CANCELLED even if no worker was left
   * alive to honour it.
   */
  cancelRequested: boolean;
  /** A terminal event arrived, or a wake wrote one. The deadline stays off. */
  settled: boolean;
}

export const INITIAL_SCENARIO_EXECUTION_STATE: ScenarioExecutionState = {
  scenarioRunId: "",
  scenarioId: "",
  batchRunId: "",
  setId: "",
  cancelRequested: false,
  settled: false,
};

/**
 * The content boundary. Simulation events carry conversation messages, so the
 * default `event.data` payload would persist customer content into process
 * state and outbox rows. This process needs identities and nothing else.
 */
export const scenarioExecutionEventViewSchema = z.object({
  scenarioRunId: z.string().nullable(),
  scenarioId: z.string().nullable(),
  batchRunId: z.string().nullable(),
  scenarioSetId: z.string().nullable(),
});

export type ScenarioExecutionEventView = z.infer<
  typeof scenarioExecutionEventViewSchema
>;

export const scenarioExecutionFailRunIntentSchema = z.object({
  projectId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  setId: z.string(),
  /** Write CANCELLED rather than ERROR. */
  cancelled: z.boolean(),
  /** Human-readable cause, recorded on the terminal event. */
  reason: z.string(),
});

export type ScenarioExecutionFailRunIntent = z.infer<
  typeof scenarioExecutionFailRunIntentSchema
>;
