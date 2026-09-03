import type { IntentSpec } from "@langwatch/eventing";
import { runParameterValuesSchema, runSecretCiphertextSchema } from "@langwatch/scenario-contract";
import { z } from "zod";

export const SIMULATION_RUN_EXECUTION_PROCESS_NAME = "simulation_run_execution" as const;

/**
 * The intents this process may emit. Property-style like the other
 * builder-mounted domains (`ctx.intents.execute(...)`); outbox rows scope
 * intentType by processName, so the short names stay unambiguous.
 */
export const SIMULATION_RUN_EXECUTION_INTENT_TYPES = {
  /** Submit the run to this pod's execution pool. */
  EXECUTE: "execute",
  /** Broadcast cancellation to whichever pod owns the child process. */
  CANCEL: "cancel",
  /** Write the terminal finished event via the pipeline commands. */
  FINISH: "finish",
} as const;

/**
 * Force-terminal backstop when a cancel broadcast never lands: the pod
 * owning the child was down, or the Redis pub/sub message was lost. The
 * cancel-grace wake fires this long after the cancel was requested and
 * finishes the run CANCELLED so it cannot hang in "cancelling" forever.
 */
export const CANCEL_GRACE_MS = 60_000;

export type SimulationRunExecutionPhase = "queued" | "running" | "cancelling" | "terminal";

/**
 * Compact private process state (ADR-052): only what evolve() decisions
 * need. Run facts for the UI live in the run-state fold projection, not
 * here.
 *
 * HARD DATA BOUNDARY: this state is persisted in Postgres. It carries ids,
 * enums and timestamps only — never conversation content (messages, verdict
 * reasoning, criteria text).
 */
export interface SimulationRunExecutionProcessState {
  /** The tenant; needed by intent payloads (outbox rows persist them). */
  projectId: string;
  /** The aggregate identity (process key). */
  scenarioRunId: string;
  phase: SimulationRunExecutionPhase;
  /** Business time of the queued event. */
  queuedAtMs: number;
  /**
   * Last observed sign of life (any event for this run), business time
   * clamped to handling time. The stall wake measures from here.
   */
  lastActivityAtMs: number;
  /**
   * When cancellation was requested, or null. Set even after the phase has
   * moved on so a late/redelivered queued event can still honour it.
   */
  cancelRequestedAtMs: number | null;
}

export const INITIAL_SIMULATION_RUN_EXECUTION_STATE: SimulationRunExecutionProcessState = {
  projectId: "",
  scenarioRunId: "",
  phase: "queued",
  queuedAtMs: 0,
  lastActivityAtMs: 0,
  cancelRequestedAtMs: null,
};

/**
 * The execute intent payload — the identity, execution target and resolved
 * parameter values `pool.submit` needs, and nothing else; no conversation
 * content. It is close to `ExecutionJobData` (execution-pool.ts) but not
 * identical: the handler renames `scenarioSetId` to `setId` and `name` to
 * `scenarioName` on the way through.
 */
export const executeRunIntentSchema = z.object({
  scenarioRunId: z.string(),
  projectId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  name: z.string().optional(),
  target: z.object({
    type: z.enum(["prompt", "http", "code", "workflow", "connected"]),
    referenceId: z.string(),
  }),
  parameters: runParameterValuesSchema.optional(),
  /**
   * The run's secret parameter values, still encrypted. The pool job carries
   * them as they are; the prefetch is the only place that decrypts.
   */
  secretParameters: runSecretCiphertextSchema.optional(),
});
export type ExecuteRunIntent = z.infer<typeof executeRunIntentSchema>;

export const cancelExecutionIntentSchema = z.object({
  scenarioRunId: z.string(),
  projectId: z.string(),
});
export type CancelExecutionIntent = z.infer<typeof cancelExecutionIntentSchema>;

export const finishRunIntentSchema = z.object({
  scenarioRunId: z.string(),
  projectId: z.string(),
  status: z.string(),
  error: z.string().optional(),
});
export type FinishRunIntent = z.infer<typeof finishRunIntentSchema>;

/**
 * The content-stripped view of a pipeline event the process consumes.
 * Optional-at-the-source fields are null here (never undefined): the view is
 * persisted verbatim as the inbox payload, and undefined is not JSON-safe.
 *
 * Deliberately narrowed so this module does NOT depend on the enriched
 * finished-event fields landing — only `status` is read from it.
 */
export const simulationRunProcessEventViewSchema = z.object({
  eventType: z.string(),
  occurredAt: z.number(),
  status: z.string().nullable(),
  scenarioId: z.string().nullable(),
  batchRunId: z.string().nullable(),
  scenarioSetId: z.string().nullable(),
  name: z.string().nullable(),
  target: z
    .object({
      type: z.enum(["prompt", "http", "code", "workflow", "connected"]),
      referenceId: z.string(),
    })
    .nullable(),
  /**
   * The run's resolved parameter values, as recorded on the queued event —
   * customer-chosen configuration, not conversation content. Defaulted rather
   * than required so inbox rows persisted before parameters existed still
   * parse instead of redelivering forever.
   */
  parameters: runParameterValuesSchema.nullable().default(null),
  /**
   * The run's secret parameter values, as recorded on the queued event and
   * still encrypted. This view is persisted verbatim as the inbox payload, so
   * only the encrypted form may travel here.
   */
  secretParameters: runSecretCiphertextSchema.nullable().default(null),
  /**
   * The names the queued event declared secret, from `metadata`. They are what
   * the ciphertext beside them is checked against: a run that declares a
   * credential and carries no readable value for it must not execute.
   */
  secretParameterNames: z.array(z.string()).nullable().default(null),
});
export type SimulationRunProcessEventView = z.infer<typeof simulationRunProcessEventViewSchema>;

/** The intents this process may emit; typed so handlers get `ctx.intents.*`. */
export type SimulationRunExecutionIntents = {
  [SIMULATION_RUN_EXECUTION_INTENT_TYPES.EXECUTE]: IntentSpec<typeof executeRunIntentSchema>;
  [SIMULATION_RUN_EXECUTION_INTENT_TYPES.CANCEL]: IntentSpec<typeof cancelExecutionIntentSchema>;
  [SIMULATION_RUN_EXECUTION_INTENT_TYPES.FINISH]: IntentSpec<typeof finishRunIntentSchema>;
};
