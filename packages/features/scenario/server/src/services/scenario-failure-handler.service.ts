import { createLogger } from "@langwatch/observability";
import type { AgentService } from "@langwatch/agent-contract";
import type { SimulationService } from "@langwatch/scenario-contract";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import {
  buildFailureResults,
  isTransportLevelScenarioFailure,
  ScenarioRunStatus,
  type ScenarioUnsuccessfulExecutionInput,
} from "@langwatch/scenario-contract";

const tracer = getLangWatchTracer("langwatch.scenarios.failure-handler");
const logger = createLogger("langwatch:scenarios:failure-handler");

export class ScenarioFailureHandlerService {
  private constructor(
    private readonly options: {
      agents: AgentService;
      simulations: SimulationService;
    },
  ) {}

  static create(input: {
    agents: AgentService;
    simulations: SimulationService;
  }): ScenarioFailureHandlerService {
    return new ScenarioFailureHandlerService(input);
  }

  /**
   * Whether the failed target is an HTTP agent whose config carries the
   * `devTunnel` marker. Only consulted for transport-level failures, so the
   * common failure paths never pay for the agent lookup; a lookup failure
   * degrades to the generic classification rather than blocking the event.
   */
  private async targetHasDevTunnel(params: ScenarioUnsuccessfulExecutionInput): Promise<boolean> {
    if (params.cancelled) {
      return false;
    }

    if (params.target?.type !== "http") {
      return false;
    }

    if (!isTransportLevelScenarioFailure(params.error)) {
      return false;
    }

    try {
      const agent = await this.options.agents.getById({
        projectId: params.projectId,
        id: params.target.referenceId,
      });

      if (agent.type !== "http") {
        return false;
      }

      const config = agent.config;

      return typeof config.devTunnel === "object" && config.devTunnel !== null;
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

  async finishUnsuccessfulRun(params: ScenarioUnsuccessfulExecutionInput): Promise<void> {
    return tracer.withActiveSpan(
      "ScenarioFailureHandlerService.finishUnsuccessfulRun",
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
        const { projectId, scenarioId, setId, batchRunId, error, cancelled } = params;
        const status = cancelled ? ScenarioRunStatus.CANCELLED : ScenarioRunStatus.ERROR;
        const scenarioRunId = params.scenarioRunId;

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

        try {
          await this.options.simulations.finishRun({
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
          logger.error({ err, scenarioRunId }, "Failed to dispatch finishRun event");

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
