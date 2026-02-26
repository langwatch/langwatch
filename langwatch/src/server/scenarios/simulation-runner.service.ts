import ScenarioRunner, { type AgentAdapter } from "@langwatch/scenario";
import type { PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import { env } from "~/env.mjs";
import { DEFAULT_MODEL } from "~/utils/constants";
import { createLogger } from "~/utils/logger/server";
import type { SimulationTarget } from "../api/routers/scenarios";
import { getVercelAIModel } from "../modelProviders/utils";
import { PromptService } from "../prompt-config/prompt.service";
import { HttpAgentAdapter } from "./adapters/http-agent.adapter";
import { PromptConfigAdapter } from "./adapters/prompt-config.adapter";
import { RemoteSpanJudgeAgent } from "./execution/remote-span-judge-agent";
import { createTraceApiSpanQuery } from "./execution/trace-api-span-query";
import { ScenarioService } from "./scenario.service";

/** Generates a unique batch run ID for grouping scenario executions */
export function generateBatchRunId(): string {
  return `scenariobatch_${nanoid()}`;
}

const logger = createLogger("SimulationRunnerService");

interface ExecuteParams {
  projectId: string;
  scenarioId: string;
  target: SimulationTarget;
  setId: string;
  batchRunId: string;
}

/**
 * Service for running scenarios against targets.
 */
export class SimulationRunnerService {
  private readonly scenarioService: ScenarioService;
  private readonly promptService: PromptService;

  constructor(private readonly prisma: PrismaClient) {
    this.scenarioService = ScenarioService.create(prisma);
    this.promptService = new PromptService(prisma);
  }

  /**
   * Execute a scenario against a target.
   * Fire and forget - returns immediately, execution happens async.
   */
  async execute(params: ExecuteParams): Promise<void> {
    const { projectId, scenarioId, target, setId, batchRunId } = params;

    try {
      // 1. Fetch scenario
      const scenario = await this.scenarioService.getById({
        projectId,
        id: scenarioId,
      });

      if (!scenario) {
        logger.error({ scenarioId, projectId }, "Scenario not found");
        return;
      }

      // 2. Fetch project config
      // TODO: We should use the project service or repository instead of prisma directly
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { apiKey: true, defaultModel: true },
      });

      if (!project?.apiKey) {
        throw new Error(`Project ${projectId} not found or has no API key`);
      }

      // 3. Get project's default model for simulator and judge agents
      const defaultModel = project.defaultModel ?? DEFAULT_MODEL;
      const simulatorModel = await getVercelAIModel(projectId, defaultModel);
      const judgeModel = await getVercelAIModel(projectId, defaultModel);

      // 4. Resolve target to adapter
      logger.debug(
        { targetType: target.type, referenceId: target.referenceId, projectId },
        "Resolving target to adapter",
      );
      const adapter = this.resolveAdapter(target, projectId, batchRunId);
      logger.debug(
        { adapterName: adapter.name, adapterRole: adapter.role },
        "Adapter resolved",
      );

      // 5. Run scenario with SDK
      // Validate batchRunId is defined before passing to SDK
      if (!batchRunId || typeof batchRunId !== "string") {
        logger.error(
          { batchRunId, type: typeof batchRunId },
          "Invalid batchRunId",
        );
        throw new Error(`Invalid batchRunId: ${batchRunId}`);
      }

      logger.info(
        {
          scenarioId,
          setId,
          batchRunId,
          batchRunIdLength: batchRunId.length,
          targetType: target.type,
          model: defaultModel,
        },
        "Starting scenario execution with batchRunId",
      );

      // Run in headless mode on server (don't open browser tabs)
      process.env.SCENARIO_HEADLESS = "true";

      // For HTTP targets, use remote span judge to collect spans from the
      // user's agent. For other targets, use standard in-process judge.
      const langwatchEndpoint = this.getLangWatchEndpoint();
      let remoteSpanJudge: RemoteSpanJudgeAgent | undefined;
      const judgeAgentInstance =
        target.type === "http"
          ? (() => {
              remoteSpanJudge = new RemoteSpanJudgeAgent({
                criteria: scenario.criteria,
                model: judgeModel,
                projectId,
                querySpans: createTraceApiSpanQuery({
                  endpoint: langwatchEndpoint,
                  apiKey: project.apiKey,
                }),
              });
              return remoteSpanJudge;
            })()
          : ScenarioRunner.judgeAgent({
              model: judgeModel,
              criteria: scenario.criteria,
            });

      // Hook trace ID capture: after adapter calls, pass trace ID to judge
      if (remoteSpanJudge && adapter instanceof HttpAgentAdapter) {
        const originalCall = remoteSpanJudge.call.bind(remoteSpanJudge);
        remoteSpanJudge.call = async (input) => {
          const traceId = adapter.getTraceId();
          if (traceId) {
            remoteSpanJudge!.setTraceId(traceId);
          }
          return originalCall(input);
        };
      }

      const result = await ScenarioRunner.run(
        {
          id: scenarioId,
          name: scenario.name,
          description: scenario.situation,
          setId,
          agents: [
            adapter,
            ScenarioRunner.userSimulatorAgent({ model: simulatorModel }),
            judgeAgentInstance,
          ],
          verbose: true,
        },
        {
          batchRunId,
          langwatch: {
            endpoint: langwatchEndpoint,
            apiKey: project.apiKey,
          },
        },
      );

      logger.info(
        {
          scenarioId,
          setId,
          runId: result.runId,
          success: result.success,
          reasoning: result.reasoning,
        },
        "Scenario execution completed",
      );
    } catch (error) {
      logger.error(
        { error, scenarioId, projectId, setId },
        "Scenario execution failed",
      );
    }
  }

  private getLangWatchEndpoint(): string {
    // Use BASE_HOST if available (self-referencing), otherwise default
    return env.BASE_HOST ?? "https://app.langwatch.ai";
  }

  private resolveAdapter(
    target: SimulationTarget,
    projectId: string,
    batchRunId?: string,
  ): AgentAdapter {
    switch (target.type) {
      case "prompt":
        return new PromptConfigAdapter(
          target.referenceId,
          this.promptService,
          projectId,
        );
      case "http":
        return HttpAgentAdapter.create({
          agentId: target.referenceId,
          projectId,
          prisma: this.prisma,
          batchRunId,
        });
      case "code":
        throw new Error(
          "Code agent targets are only supported via the child process execution path",
        );
      default: {
        const _exhaustive: never = target.type;
        throw new Error(`Unknown target type: ${_exhaustive}`);
      }
    }
  }

  static create(prisma: PrismaClient): SimulationRunnerService {
    return new SimulationRunnerService(prisma);
  }
}
