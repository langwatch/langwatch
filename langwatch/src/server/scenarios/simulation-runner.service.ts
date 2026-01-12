import ScenarioRunner, { type AgentAdapter } from "@langwatch/scenario";
import type { PrismaClient } from "@prisma/client";
import { PromptService } from "../prompt-config/prompt.service";
import { ScenarioService } from "./scenario.service";
import type { SimulationTarget } from "../api/routers/scenarios";
import { createLogger } from "~/utils/logger";
import { PromptConfigAdapter } from "./adapters/prompt-config.adapter";
import { HttpAgentAdapter } from "./adapters/http-agent.adapter";
import { env } from "~/env.mjs";
import { getVercelAIModel } from "../modelProviders/utils";
import { DEFAULT_MODEL } from "~/utils/constants";

const logger = createLogger("SimulationRunnerService");

interface ExecuteParams {
  projectId: string;
  scenarioId: string;
  target: SimulationTarget;
  setId: string;
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
    const { projectId, scenarioId, target, setId } = params;

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
        "Resolving target to adapter"
      );
      const adapter = this.resolveAdapter(target, projectId);
      logger.debug(
        { adapterName: adapter.name, adapterRole: adapter.role },
        "Adapter resolved"
      );

      // 5. Run scenario with SDK
      logger.info(
        { scenarioId, setId, targetType: target.type, model: defaultModel },
        "Starting scenario execution"
      );

      const result = await ScenarioRunner.run(
        {
          id: scenarioId,
          name: scenario.name,
          description: scenario.situation,
          setId,
          agents: [
            adapter,
            ScenarioRunner.userSimulatorAgent({ model: simulatorModel }),
            ScenarioRunner.judgeAgent({ model: judgeModel, criteria: scenario.criteria }),
          ],
          verbose: true,
        },
        {
          langwatch: {
            endpoint: this.getLangWatchEndpoint(),
            apiKey: project.apiKey,
          },
        }
      );

      logger.info(
        {
          scenarioId,
          setId,
          runId: result.runId,
          success: result.success,
          reasoning: result.reasoning,
        },
        "Scenario execution completed"
      );
    } catch (error) {
      logger.error(
        { error, scenarioId, projectId, setId },
        "Scenario execution failed"
      );
    }
  }

  private getLangWatchEndpoint(): string {
    // Use BASE_HOST if available (self-referencing), otherwise default
    return env.BASE_HOST ?? "https://app.langwatch.ai";
  }

  private resolveAdapter(
    target: SimulationTarget,
    projectId: string
  ): AgentAdapter {
    switch (target.type) {
      case "prompt":
        return new PromptConfigAdapter(
          target.referenceId,
          this.promptService,
          projectId
        );
      case "http":
        return HttpAgentAdapter.create({
          agentId: target.referenceId,
          projectId,
          prisma: this.prisma,
        });
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
