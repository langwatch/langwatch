import ScenarioRunner, { type AgentAdapter } from "@langwatch/scenario";
import type { PrismaClient } from "@prisma/client";
import { PromptService } from "../prompt-config/prompt.service";
import { ScenarioService } from "./scenario.service";
import type { SimulationTarget } from "../api/routers/scenarios";
import { createLogger } from "~/utils/logger";
import { PromptConfigAdapter } from "./adapters/prompt-config.adapter";
import { env } from "~/env.mjs";

const logger = createLogger("SimulationRunnerService");

/**
 * Simple mutex for serializing scenario executions.
 *
 * TODO: Remove this mutex once @langwatch/scenario SDK supports
 * programmatic config via ScenarioConfig.langwatch option.
 * See: https://github.com/langwatch/langwatch/issues/XXX
 */
class Mutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (!this.locked) {
          this.locked = true;
          resolve(() => this.release());
        } else {
          this.queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

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
  /**
   * Mutex to serialize scenario executions.
   * Required because @langwatch/scenario SDK reads LANGWATCH_API_KEY
   * and LANGWATCH_ENDPOINT from process.env, not from config.
   *
   * TODO: Remove once SDK supports ScenarioConfig.langwatch option.
   */
  private static readonly executionMutex = new Mutex();

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

    // Acquire mutex to ensure only one scenario runs at a time
    // This allows us to safely mutate process.env for SDK config
    const release = await SimulationRunnerService.executionMutex.acquire();
    const originalApiKey = process.env.LANGWATCH_API_KEY;
    const originalEndpoint = process.env.LANGWATCH_ENDPOINT;
    const originalHeadless = process.env.SCENARIO_HEADLESS;

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

      // 2. Fetch project API key and configure SDK env vars
      const apiKey = await this.getProjectApiKey(projectId);
      process.env.LANGWATCH_API_KEY = apiKey;
      process.env.LANGWATCH_ENDPOINT = this.getLangWatchEndpoint();
      process.env.SCENARIO_HEADLESS = "true"; // Prevent browser opening on server

      // 3. Resolve target to adapter
      const adapter = this.resolveAdapter(target, projectId);

      // 4. Run scenario with SDK
      logger.info(
        { scenarioId, setId, targetType: target.type },
        "Starting scenario execution",
      );

      const result = await ScenarioRunner.run({
        id: scenarioId,
        name: scenario.name,
        description: scenario.situation,
        setId: setId,
        agents: [adapter],
        verbose: true,
      });

      logger.info(
        {
          scenarioId,
          setId,
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
    } finally {
      // Restore original env vars and release mutex
      process.env.LANGWATCH_API_KEY = originalApiKey;
      process.env.LANGWATCH_ENDPOINT = originalEndpoint;
      process.env.SCENARIO_HEADLESS = originalHeadless;
      release();
    }
  }

  private async getProjectApiKey(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { apiKey: true },
    });

    if (!project?.apiKey) {
      throw new Error(`Project ${projectId} not found or has no API key`);
    }

    return project.apiKey;
  }

  private getLangWatchEndpoint(): string {
    // Use BASE_HOST if available (self-referencing), otherwise default
    return env.BASE_HOST ?? "https://app.langwatch.ai";
  }

  private resolveAdapter(
    target: SimulationTarget,
    projectId: string,
  ): AgentAdapter {
    switch (target.type) {
      case "prompt":
        return new PromptConfigAdapter(
          target.referenceId,
          this.promptService,
          projectId,
        );
      default:
        throw new Error(`Unknown target type: ${target.type}`);
    }
  }

  static create(prisma: PrismaClient): SimulationRunnerService {
    return new SimulationRunnerService(prisma);
  }
}

