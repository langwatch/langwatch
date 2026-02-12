/**
 * Scenario execution orchestrator.
 *
 * Coordinates the execution of a scenario by delegating to injected
 * dependencies. Each method is focused on a single responsibility.
 */

import { createLogger } from "~/utils/logger/server";
import type {
  ExecutionInput,
  OrchestratorDependencies,
  TracerHandle,
} from "./orchestrator.types";
import type {
  LiteLLMParams,
  ScenarioConfig,
  ScenarioExecutionResult,
} from "./types";

const logger = createLogger("langwatch:scenarios:orchestrator");

export class ScenarioExecutionOrchestrator {
  constructor(private readonly deps: OrchestratorDependencies) {}

  async execute(input: ExecutionInput): Promise<ScenarioExecutionResult> {
    const { context, target } = input;
    let tracerHandle: TracerHandle | undefined;

    try {
      const scenario = await this.fetchScenario(
        context.projectId,
        context.scenarioId,
      );
      if (!scenario) {
        return this.notFound("Scenario", context.scenarioId);
      }

      const project = await this.fetchProject(context.projectId);
      if (!project) {
        return this.notFound("Project", context.projectId);
      }

      if (!project.defaultModel) {
        return this.failure("Project default model is not configured");
      }

      const modelParamsResult = await this.prepareModelParams(
        context.projectId,
        project.defaultModel,
      );
      if (!modelParamsResult.success) {
        return this.failure(modelParamsResult.message);
      }

      const adapterResult = await this.createAdapter(
        context.projectId,
        target,
        modelParamsResult.params,
      );
      if (!adapterResult.success) {
        return this.failure(adapterResult.error);
      }

      tracerHandle = this.createTracer(project.apiKey, scenario.id, context);

      return await this.runScenario(
        scenario,
        adapterResult.adapter,
        modelParamsResult.params,
        context.batchRunId,
        { endpoint: this.deps.telemetryEndpoint, apiKey: project.apiKey },
      );
    } catch (error) {
      logger.error({ error, context }, "Scenario execution failed");
      return this.failure(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      await this.shutdownTracer(tracerHandle);
    }
  }

  private async fetchScenario(projectId: string, scenarioId: string) {
    return this.deps.scenarioRepository.getById({ projectId, id: scenarioId });
  }

  private async fetchProject(projectId: string) {
    return this.deps.projectRepository.getProject(projectId);
  }

  private async prepareModelParams(projectId: string, model: string) {
    return this.deps.modelParamsProvider.prepare(projectId, model);
  }

  private async createAdapter(
    projectId: string,
    target: ExecutionInput["target"],
    modelParams: LiteLLMParams,
  ) {
    return this.deps.adapterFactory.create({
      projectId,
      target,
      modelParams,
      nlpServiceUrl: this.deps.nlpServiceUrl,
    });
  }

  private createTracer(
    apiKey: string,
    scenarioId: string,
    context: ExecutionInput["context"],
  ) {
    return this.deps.tracerFactory.create({
      endpoint: this.deps.telemetryEndpoint,
      apiKey,
      scenarioId,
      batchRunId: context.batchRunId,
      projectId: context.projectId,
    });
  }

  private async runScenario(
    scenario: ScenarioConfig,
    adapter: Parameters<typeof this.deps.scenarioExecutor.run>[1],
    modelParams: LiteLLMParams,
    batchRunId: string,
    telemetry: { endpoint: string; apiKey: string },
  ) {
    return this.deps.scenarioExecutor.run(
      scenario,
      adapter,
      modelParams,
      this.deps.nlpServiceUrl,
      batchRunId,
      telemetry,
    );
  }

  private async shutdownTracer(tracerHandle: TracerHandle | undefined) {
    if (!tracerHandle) return;

    try {
      await tracerHandle.shutdown();
    } catch (error) {
      // Log but don't propagate - scenario result is more important
      logger.warn(
        { error },
        "Tracer shutdown failed, traces may be incomplete",
      );
    }
  }

  private notFound(entity: string, id: string): ScenarioExecutionResult {
    logger.warn({ entity, id }, `${entity} not found`);
    return { success: false, error: `${entity} ${id} not found` };
  }

  private failure(error: string): ScenarioExecutionResult {
    return { success: false, error };
  }
}
