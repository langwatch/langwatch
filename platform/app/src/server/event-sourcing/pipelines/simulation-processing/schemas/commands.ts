/**
 * The simulation command payloads that are not derived from an event.
 *
 * Almost nothing needs to live here, and that is the point. Every
 * `defineCommand` command builds its payload schema from the matching event data
 * schema via `withCommandEnvelope`, and `processCommand` constructs the command
 * from what THAT schema parsed — so a hand-written copy of a payload in this
 * file validates nothing, while quietly reading as the contract. One such copy
 * omitted `batchRunId`/`scenarioSetId` long after the events carried them, which
 * is exactly how "the command cannot pass the set id" became a plausible-looking
 * conclusion. `events.ts` is the single source of truth for those payloads; the
 * placement fields themselves are the shared `runPlacementFields` spread in
 * `./shared`.
 *
 * What is left is what has no event schema to derive from:
 *   - `queueRunCommandDataSchema`, for the type the suite-run service dispatches
 *     through;
 *   - `computeRunMetricsCommandDataSchema`, whose command is a manual class (it
 *     reads state before it can emit anything) and really does validate here.
 */
import { z } from "zod";

const queueRunCommandDataSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  batchRunId: z.string(),
  scenarioSetId: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  /**
   * Target for execution. Carried into the `scenarioExecution` process
   * manager's dispatch so it spawns the right adapter.
   */
  target: z
    .object({
      type: z.enum(["prompt", "http", "code", "workflow"]),
      referenceId: z.string(),
    })
    .optional(),
  /** Size of the batch this run belongs to (ADR-072). 1 for an ad-hoc run. */
  batchTotal: z.number().int().nonnegative().optional(),
  occurredAt: z.number(),
});
export type QueueRunCommandData = z.infer<typeof queueRunCommandDataSchema>;

/**
 * Compute one run's cost/latency from every trace it produced.
 *
 * The unit is the RUN, not the trace: the command reads the run's traces once,
 * aggregates over all of them, and emits a single `metrics_recorded` event
 * carrying the totals. Its predecessor was dispatched per trace and emitted a
 * per-trace event, which forced the run's fold to keep an unbounded per-trace
 * map to re-aggregate from and, because the per-trace idempotency key never
 * varied, could never correct a partial first answer.
 *
 * The payload is an identity alone. Which traces the run produced is read from
 * its stored state when the command runs, so nothing upstream has to accumulate
 * trace ids, and a trace that landed after the run finished is measured rather
 * than missed.
 */
export const computeRunMetricsCommandDataSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  occurredAt: z.number(),
});
export type ComputeRunMetricsCommandData = z.infer<
  typeof computeRunMetricsCommandDataSchema
>;
