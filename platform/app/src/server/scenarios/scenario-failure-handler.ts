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
import { AgentService } from "~/server/agents/agent.service";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { AgentDevTunnelUnreachableError } from "~/server/scenarios/errors";
import {
  ScenarioRunStatus,
  Verdict,
} from "~/server/scenarios/scenario-event.enums";
import {
  classifyScenarioInfraError,
  encodeScenarioError,
  isTransportLevelScenarioFailure,
  ScenarioInfraErrorCode,
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
  /** When true, writes CANCELLED status instead of ERROR */
  cancelled?: boolean;
  /**
   * The run's target, carried from the job data. Lets a transport failure on
   * an HTTP agent whose config carries `devTunnel` be named a dead dev tunnel
   * instead of a generic connection error.
   */
  target?: { type: string; referenceId: string };
}

/** Reads the target agent's config so the devTunnel marker can be checked. */
export type AgentConfigLookup = (params: {
  projectId: string;
  agentId: string;
}) => Promise<Record<string, unknown> | null>;

const defaultAgentConfigLookup: AgentConfigLookup = async ({
  projectId,
  agentId,
}) => {
  const agent = await AgentService.create(prisma).getById({
    id: agentId,
    projectId,
  });
  return (agent?.config as Record<string, unknown> | undefined) ?? null;
};

function buildFailureResults(params: {
  cancelled: boolean;
  error?: string;
  targetHasDevTunnel?: boolean;
}) {
  if (params.cancelled) {
    return {
      verdict: Verdict.INCONCLUSIVE,
      reasoning: "Cancelled by user",
      metCriteria: [],
      unmetCriteria: [],
      error: params.error ?? "Cancelled by user",
    };
  }

  // A transport failure on an agent still carrying a `devTunnel` marker is
  // the exact confusion the marker exists to remove: the developer's
  // `langwatch agent dev` session ended without restoring the URL. Name it,
  // rather than reporting a generic unreachable endpoint.
  if (
    params.targetHasDevTunnel &&
    isTransportLevelScenarioFailure(params.error)
  ) {
    const handled = new AgentDevTunnelUnreachableError();
    return {
      verdict: Verdict.FAILURE,
      reasoning: handled.message,
      metCriteria: [],
      unmetCriteria: [],
      error: encodeScenarioError({
        code: ScenarioInfraErrorCode.AgentDevTunnelUnreachable,
        message: handled.message,
        hint: "Run `langwatch agent dev` again on the machine that started the tunnel, or restore the agent's URL in its settings.",
      }),
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
 * Dispatches startRun + finishRun commands via event-sourcing so ClickHouse
 * gets the terminal status and the UI updates via SSE.
 */
export class ScenarioFailureHandler {
  private readonly agentConfigLookup: AgentConfigLookup;

  constructor(agentConfigLookup: AgentConfigLookup = defaultAgentConfigLookup) {
    this.agentConfigLookup = agentConfigLookup;
  }

  static create(agentConfigLookup?: AgentConfigLookup): ScenarioFailureHandler {
    return new ScenarioFailureHandler(agentConfigLookup);
  }

  /**
   * Whether the failed target is an HTTP agent whose config carries the
   * `devTunnel` marker. Only consulted for transport-level failures, so the
   * common failure paths never pay for the agent lookup; a lookup failure
   * degrades to the generic classification rather than blocking the event.
   */
  private async targetHasDevTunnel(
    params: FailureEventParams,
  ): Promise<boolean> {
    if (params.cancelled) return false;
    if (params.target?.type !== "http") return false;
    if (!isTransportLevelScenarioFailure(params.error)) return false;
    try {
      const config = await this.agentConfigLookup({
        projectId: params.projectId,
        agentId: params.target.referenceId,
      });
      return (
        !!config &&
        typeof config.devTunnel === "object" &&
        config.devTunnel !== null
      );
    } catch (err) {
      logger.warn(
        {
          err,
          projectId: params.projectId,
          agentId: params.target.referenceId,
        },
        "Could not read the target agent config for dev tunnel classification",
      );
      return false;
    }
  }

  /**
   * Ensures failure events are emitted for a failed scenario job.
   *
   * Dispatches startRun (if needed) and finishRun with ERROR/CANCELLED status
   * via event-sourcing. The finishRun command is idempotent.
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
        const { projectId, scenarioId, setId, batchRunId, error, cancelled } =
          params;
        const status = cancelled
          ? ScenarioRunStatus.CANCELLED
          : ScenarioRunStatus.ERROR;
        const scenarioRunId = params.scenarioRunId;

        if (!scenarioRunId) {
          logger.warn(
            { projectId, scenarioId, batchRunId },
            "No scenarioRunId provided, cannot emit failure events",
          );
          return;
        }

        logger.info(
          {
            projectId,
            scenarioId,
            setId,
            batchRunId,
            scenarioRunId,
            status,
            error: error?.substring(0, 100),
          },
          "Emitting failure events via event-sourcing",
        );

        const timestamp = Date.now();
        span.setAttribute("scenario.run.id", scenarioRunId);

        const targetHasDevTunnel = await this.targetHasDevTunnel(params);

        // Dispatch finishRun with ERROR/CANCELLED status
        try {
          await getApp().simulations.finishRun({
            tenantId: projectId,
            scenarioRunId,
            occurredAt: timestamp,
            status,
            results: buildFailureResults({
              cancelled: cancelled ?? false,
              error,
              targetHasDevTunnel,
            }),
          });
          span.setAttribute("result.emitted_run_finished", true);
        } catch (err) {
          logger.error(
            { err, scenarioRunId },
            "Failed to dispatch finishRun event",
          );
          throw err;
        }

        logger.info(
          { projectId, scenarioId, scenarioRunId, batchRunId, status },
          "Failure events emitted",
        );
      },
    );
  }
}
