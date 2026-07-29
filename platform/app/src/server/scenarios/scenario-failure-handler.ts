/**
 * ScenarioFailureHandler service.
 *
 * Ensures failure events are emitted via event-sourcing when scenario jobs
 * fail (child process crash, timeout, prefetch error). This provides
 * visibility into job failures that would otherwise result in runs stuck
 * as IN_PROGRESS forever.
 *
 * @see specs/scenarios/scenario-failure-handler.feature
 */

import { createLogger } from "@langwatch/observability";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { getApp } from "~/server/app-layer/app";
import { Verdict } from "~/server/scenarios/scenario-event.enums";
import {
  type ScenarioFailureOutcome,
  statusForFailureOutcome,
} from "~/server/scenarios/scenario-failure-outcome";
import {
  classifyScenarioInfraError,
  encodeScenarioError,
} from "~/server/scenarios/scenario-infra-error";

const tracer = getLangWatchTracer("langwatch.scenarios.failure-handler");
const logger = createLogger("langwatch:scenarios:failure-handler");

/** Parameters for ensuring failure events are emitted */
export interface FailureEventParams {
  projectId: string;
  scenarioId: string;
  setId: string;
  batchRunId: string;
  /** Pre-assigned scenario run ID from the job queue. */
  scenarioRunId?: string;
  error?: string;
  /** Scenario name for display in UI */
  name?: string;
  /** Scenario description/situation for display in UI */
  description?: string;
  /**
   * How the run ended. Decides the terminal status written: ERROR by default,
   * CANCELLED when a user asked it to stop, STALLED when nothing reported on
   * it for longer than it was allowed to stay quiet.
   *
   * One modelled field rather than a flag per outcome — see
   * `scenario-failure-outcome.ts`.
   */
  outcome?: ScenarioFailureOutcome;
}

/**
 * The child's own exit code, when the raw failure string is the parent's
 * "Child process exited with code N: …" wrapper.
 *
 * Worth pulling out on its own because it is the one piece of that string that
 * is ours, bounded, and diagnostic — everything after the colon is the child's
 * unsanitised stderr, which must not be logged at info.
 */
function exitCodeFrom(error: string | undefined): number | undefined {
  const match = /^Child process exited with code (\d+)/i.exec(error ?? "");
  return match ? Number(match[1]) : undefined;
}

/**
 * Where the run sits, in the shape `finishRun` carries it.
 *
 * This is the only terminal path for every reaped run — a stalled run, one
 * whose cancel nobody honoured, one whose executor faulted after dispatch, and
 * both boot sweeps — so what it omits, nothing else supplies. The SSE nudge
 * reads the set and batch ids straight off the committed event
 * (`snapshotUpdateBroadcast.subscriber.ts`), and the run-history panel drops a
 * push whose `scenarioSetId` does not match the set it is showing. Dropping
 * them here therefore left an open suite panel displaying a dead run as
 * IN_PROGRESS until the user navigated away.
 *
 * Empty ids are omitted rather than sent blank: an empty string is not the set
 * any panel is filtered to, so it would be dropped exactly as `undefined` is,
 * while claiming on the event that the run has a placement.
 */
function runPlacement({
  batchRunId,
  setId,
}: {
  batchRunId: string;
  setId: string;
}): { batchRunId?: string; scenarioSetId?: string } {
  return {
    ...(batchRunId ? { batchRunId } : {}),
    ...(setId ? { scenarioSetId: setId } : {}),
  };
}

function buildFailureResults(params: {
  outcome: ScenarioFailureOutcome;
  error?: string;
}) {
  if (params.outcome === "cancelled") {
    return {
      verdict: Verdict.INCONCLUSIVE,
      reasoning: "Cancelled by user",
      metCriteria: [],
      unmetCriteria: [],
      error: params.error ?? "Cancelled by user",
    };
  }

  // Turn the raw runner failure (often a multi-line child-process dump) into a
  // handled error: a stable code + human message + actionable hint. `reasoning`
  // keeps the plain human sentence for any consumer that reads it as text; the
  // `error` field carries the encoded envelope so the drawer can render a clean,
  // actionable message instead of a stack trace.
  const handled = classifyScenarioInfraError(params.error);
  return {
    verdict: Verdict.FAILURE,
    reasoning: handled.message,
    metCriteria: [],
    unmetCriteria: [],
    error: encodeScenarioError(handled),
  };
}

/**
 * Handles emission of failure events when scenario jobs fail.
 *
 * Dispatches the finishRun command — and only finishRun — via event-sourcing,
 * so ClickHouse gets the terminal status and the UI updates via SSE. The
 * scenarioRunId is pre-assigned by whoever queued the run, so there is no
 * startRun to synthesise here.
 */
export class ScenarioFailureHandler {
  static create(): ScenarioFailureHandler {
    return new ScenarioFailureHandler();
  }

  /**
   * Ensures failure events are emitted for a failed scenario job.
   *
   * Dispatches finishRun with the terminal status `statusForFailureOutcome`
   * picks for the outcome — ERROR, CANCELLED or STALLED. The finishRun command
   * is idempotent.
   */
  async ensureFailureEventsEmitted(params: FailureEventParams): Promise<void> {
    return tracer.withActiveSpan(
      "ScenarioFailureHandler.ensureFailureEventsEmitted",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.id": params.scenarioId,
          "scenario.set.id": params.setId,
          "batch.run.id": params.batchRunId,
        },
      },
      async (span) => {
        const { projectId, scenarioId, setId, batchRunId, error, name, description } = params;
        const outcome = params.outcome ?? "error";
        const status = statusForFailureOutcome(outcome);
        const scenarioRunId = params.scenarioRunId;

        if (!scenarioRunId) {
          logger.warn({ projectId, scenarioId, batchRunId }, "No scenarioRunId provided, cannot emit failure events");
          return;
        }

        // A classified reason and the child's exit code, never a positional
        // slice of the raw failure string: that string is usually
        // "Child process exited with code N: <stderr>", and the stderr half is
        // the runner's own output about the customer's conversation. The first
        // 100 characters of it are still content. The raw window stays at
        // debug for a local reproduction.
        const classified = classifyScenarioInfraError(error);
        logger.info(
          {
            projectId,
            scenarioId,
            setId,
            batchRunId,
            scenarioRunId,
            status,
            errorCode: classified.code,
            exitCode: exitCodeFrom(error),
          },
          "Emitting failure events via event-sourcing",
        );
        logger.debug(
          { scenarioRunId, error: error?.substring(0, 100) },
          "Scenario failure, raw error window",
        );

        const timestamp = Date.now();
        span.setAttribute("scenario.run.id", scenarioRunId);

        // Dispatch finishRun with the outcome's terminal status
        try {
          await getApp().simulations.finishRun({
            tenantId: projectId,
            scenarioRunId,
            occurredAt: timestamp,
            status,
            ...runPlacement({ batchRunId, setId }),
            results: buildFailureResults({ outcome, error }),
          });
          span.setAttribute("result.emitted_run_finished", true);
        } catch (err) {
          logger.error({ err, scenarioRunId }, "Failed to dispatch finishRun event");
          throw err;
        }

        logger.info({ projectId, scenarioId, scenarioRunId, batchRunId, status }, "Failure events emitted");
      },
    );
  }
}
