import { createLogger } from "@langwatch/observability";

import type { IntentExecutor } from "~/server/event-sourcing/pipeline/processManagerDefinition";

import type { ComputeRunMetricsCommandData } from "../schemas/commands";
import type { RunMetricsComputeIntent } from "./runMetricsProcess.types";

const logger = createLogger(
  "langwatch:simulation-processing:run-metrics-process",
);

export interface RunMetricsDispatchDeps {
  /**
   * Sends the `computeRunMetrics` command. This pipeline registers the command
   * itself, so the port is bound from the pipeline factory (ADR-082 §5) and
   * resolves on first dispatch.
   */
  computeRunMetrics: (data: ComputeRunMetricsCommandData) => Promise<void>;
}

/**
 * Executes the `computeRunMetrics` intent: asks for a finished run's cost and
 * latency, once, for the whole run.
 *
 * The handler does one queue send and returns — it holds nothing while the
 * command runs. A rejection re-leases the message, which is safe because the
 * command is a pure read-and-emit whose event is keyed on the values it
 * computed: a repeat that computes the same answer collapses, and one that
 * computes a better answer replaces.
 */
export function createRunMetricsComputeHandler(
  deps: RunMetricsDispatchDeps,
): IntentExecutor<RunMetricsComputeIntent> {
  return async (payload) => {
    logger.debug(
      { tenantId: payload.tenantId, scenarioRunId: payload.scenarioRunId },
      "Dispatching computeRunMetrics for a settled run",
    );

    await deps.computeRunMetrics({
      tenantId: payload.tenantId,
      scenarioRunId: payload.scenarioRunId,
      occurredAt: Date.now(),
    });
  };
}
