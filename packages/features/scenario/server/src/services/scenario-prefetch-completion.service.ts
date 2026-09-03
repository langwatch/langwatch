import { HandledError } from "@langwatch/handled-error";
import { ModelNotConfiguredError } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import { resolveRunModels } from "@langwatch/scenario-contract";
import type { TraceService } from "@langwatch/trace-contract";

import type { ScenarioExecutionLookupService } from "./scenario-execution-lookup.service";
import type {
  ScenarioExecutionPrefetchInput,
  ScenarioExecutionPrefetchResult,
  TargetAdapterData,
  TargetConfig,
} from "@langwatch/scenario-contract";
import {
  type ModelParamsResult,
  ScenarioModelParametersService,
} from "./scenario-model-parameters.service";
import type { ScenarioTargetPrefetchService } from "./scenario-target-prefetch.service";
import type { ScenarioExecutionPrefetchConfig } from "../services/scenario-execution-prefetcher.service";

const logger = createLogger("langwatch:scenarios:data-prefetcher");

export type ScenarioPrefetchLookups = {
  scenario: ReturnType<ScenarioExecutionLookupService["tryFetchScenario"]>;
  project: ReturnType<ScenarioExecutionLookupService["fetchProject"]>;
  adapter: ReturnType<ScenarioTargetPrefetchService["tryFetch"]>;
  suite: ReturnType<ScenarioExecutionLookupService["tryFetchSuite"]>;
};

type ScenarioResult = NonNullable<
  Awaited<ReturnType<ScenarioExecutionLookupService["tryFetchScenario"]>>
>;
type SuiteOverrides = Awaited<ReturnType<ScenarioExecutionLookupService["tryFetchSuite"]>>;

type ValidatedLookups =
  | {
      success: true;
      scenario: ScenarioResult;
      project: { apiKey: string };
      adapter: TargetAdapterData;
      suite: SuiteOverrides;
    }
  | { success: false; result: ScenarioExecutionPrefetchResult };

type ResolvedModels =
  | {
      success: true;
      adapter: string | undefined;
      simulator: string;
      judge: string;
    }
  | { success: false; result: ScenarioExecutionPrefetchResult };

type PreparedModels = {
  adapter: ModelParamsResult | undefined;
  simulator: ModelParamsResult;
  judge: ModelParamsResult;
};

export class ScenarioPrefetchCompletionService {
  static create(options: {
    config: ScenarioExecutionPrefetchConfig;
    lookups: ScenarioExecutionLookupService;
    modelParameters: ScenarioModelParametersService;
    traces: TraceService;
  }): ScenarioPrefetchCompletionService {
    return new ScenarioPrefetchCompletionService(options);
  }

  private constructor(
    private readonly options: {
      config: ScenarioExecutionPrefetchConfig;
      lookups: ScenarioExecutionLookupService;
      modelParameters: ScenarioModelParametersService;
      traces: TraceService;
    },
  ) {}

  async complete(input: {
    context: ScenarioExecutionPrefetchInput["context"];
    target: TargetConfig;
    lookups: ScenarioPrefetchLookups;
  }): Promise<ScenarioExecutionPrefetchResult> {
    const [scenario, project, adapter, suite] = await Promise.all([
      input.lookups.scenario,
      input.lookups.project,
      input.lookups.adapter,
      input.lookups.suite,
    ]);
    const validated = this.validateLookups(input.context, input.target, {
      scenario,
      project,
      adapter,
      suite,
    });
    if (!validated.success) {
      return validated.result;
    }

    this.applyPromptMappings(validated.adapter, input.target, validated.suite);
    const models = await this.resolveModels(input.context, validated);
    if (!models.success) {
      return models.result;
    }

    const prepared = await this.prepareModels(input.context.projectId, models);
    const modelFailure = this.modelFailure(input.context, models, prepared);
    if (modelFailure) {
      return modelFailure;
    }

    const traceWaitTimeoutMs =
      input.target.type === "http"
        ? await this.options.traces.resolveIngestWaitTimeout({
            projectId: input.context.projectId,
          })
        : void 0;

    logger.debug(
      {
        projectId: input.context.projectId,
        scenarioId: input.context.scenarioId,
        targetType: input.target.type,
      },
      "Prefetch complete",
    );

    return this.successResult({
      context: input.context,
      target: input.target,
      validated,
      models,
      prepared,
      traceWaitTimeoutMs,
    });
  }

  private validateLookups(
    context: ScenarioExecutionPrefetchInput["context"],
    target: TargetConfig,
    lookups: {
      scenario: Awaited<ReturnType<ScenarioExecutionLookupService["tryFetchScenario"]>>;
      project: Awaited<ReturnType<ScenarioExecutionLookupService["fetchProject"]>>;
      adapter: Awaited<ReturnType<ScenarioTargetPrefetchService["tryFetch"]>>;
      suite: SuiteOverrides;
    },
  ): ValidatedLookups {
    if (!lookups.scenario) {
      logger.warn(
        { projectId: context.projectId, scenarioId: context.scenarioId },
        "Scenario not found",
      );
      return {
        success: false,
        result: {
          success: false,
          error: `Scenario ${context.scenarioId} not found`,
        },
      };
    }
    if (!lookups.project.success) {
      logger.warn(
        { projectId: context.projectId, error: lookups.project.error },
        "Project fetch failed",
      );
      return {
        success: false,
        result: { success: false, error: lookups.project.error },
      };
    }
    if (lookups.adapter !== null && "success" in lookups.adapter) {
      logger.warn(
        {
          projectId: context.projectId,
          targetType: target.type,
          reason: lookups.adapter.reason,
        },
        `Workflow LLM hydration failed: ${lookups.adapter.message}`,
      );
      return {
        success: false,
        result: {
          success: false,
          error: lookups.adapter.message,
          reason: lookups.adapter.reason,
        },
      };
    }
    if (!lookups.adapter) {
      logger.warn(
        {
          projectId: context.projectId,
          targetType: target.type,
          targetReferenceId: target.referenceId,
        },
        "Target adapter not found",
      );
      return {
        success: false,
        result: {
          success: false,
          error: `${this.targetLabel(target)} ${target.referenceId} not found`,
        },
      };
    }

    return {
      success: true,
      scenario: lookups.scenario,
      project: lookups.project.data,
      adapter: lookups.adapter,
      suite: lookups.suite,
    };
  }

  private targetLabel(target: TargetConfig): string {
    switch (target.type) {
      case "prompt":
        return "Prompt";
      case "code":
        return "Code agent";
      case "workflow":
        return "Workflow agent";
      case "connected":
        return "Connected agent";
      case "http":
        return "HTTP agent";
    }
  }

  private applyPromptMappings(
    adapter: TargetAdapterData,
    target: TargetConfig,
    suite: SuiteOverrides,
  ): void {
    if (adapter.type !== "prompt") {
      return;
    }
    adapter.scenarioMappings = suite?.targets?.find(
      (candidate) => candidate.type === "prompt" && candidate.referenceId === target.referenceId,
    )?.scenarioMappings;
  }

  private async resolveModels(
    context: ScenarioExecutionPrefetchInput["context"],
    lookups: Extract<ValidatedLookups, { success: true }>,
  ): Promise<ResolvedModels> {
    try {
      const adapter =
        lookups.adapter.type === "prompt"
          ? lookups.adapter.model
            ? lookups.adapter.model
            : await this.options.lookups.resolveModel({
                featureKey: "scenarios.agent_under_test",
                projectId: context.projectId,
              })
          : void 0;
      // The plan's pick, else the case's, else the project default — and each
      // answer expanded, because a `latest` alias is stored verbatim and no
      // provider understands it as a model id.
      const { simulatorModel, judgeModel } = await resolveRunModels({
        plan: {
          simulatorModel: lookups.suite?.simulatorModel,
          judgeModel: lookups.suite?.judgeModel,
        },
        scenario: {
          simulatorModel: lookups.scenario.simulatorModel,
          judgeModel: lookups.scenario.judgeModel,
        },
        resolveFeatureModel: (featureKey) =>
          this.options.lookups.resolveModel({ featureKey, projectId: context.projectId }),
      });
      return { success: true, adapter, simulator: simulatorModel, judge: judgeModel };
    } catch (error) {
      // A project with no model set for scenarios is the customer's to fix and
      // carries its own remediation message, so it is named rather than left
      // reasonless — otherwise the caller cannot tell it from a fault of ours.
      //
      // Any other failure here is ours. `error` reaches the customer as the
      // reason a run was refused, so only a message LangWatch authored may go
      // in it. A HandledError carries a customer-safe message by contract;
      // everything else is logged and named in one sentence.
      if (!(error instanceof HandledError)) {
        logger.error(
          { projectId: context.projectId, error },
          "Model resolution failed for a scenario run",
        );
      }
      return {
        success: false,
        result: {
          success: false,
          error:
            error instanceof HandledError
              ? error.message
              : "The models this run needs could not be resolved",
          ...(error instanceof ModelNotConfiguredError
            ? { reason: "model_not_configured" as const }
            : {}),
        },
      };
    }
  }

  private async prepareModels(
    projectId: string,
    models: Extract<ResolvedModels, { success: true }>,
  ): Promise<PreparedModels> {
    const [adapter, simulator, judge] = await Promise.all([
      models.adapter !== void 0
        ? this.options.modelParameters.prepare({
            projectId,
            model: models.adapter,
          })
        : Promise.resolve(void 0),
      this.options.modelParameters.prepare({ projectId, model: models.simulator }),
      this.options.modelParameters.prepare({ projectId, model: models.judge }),
    ]);
    return { adapter, simulator, judge };
  }

  private modelFailure(
    context: ScenarioExecutionPrefetchInput["context"],
    models: Extract<ResolvedModels, { success: true }>,
    prepared: PreparedModels,
  ): ScenarioExecutionPrefetchResult | null {
    const checks = [
      { role: "adapter", model: models.adapter, result: prepared.adapter },
      { role: "user-simulator", model: models.simulator, result: prepared.simulator },
      { role: "judge", model: models.judge, result: prepared.judge },
    ];
    for (const check of checks) {
      if (!check.result || check.result.success) {
        continue;
      }
      logger.warn(
        {
          projectId: context.projectId,
          role: check.role,
          model: check.model,
          reason: check.result.reason,
        },
        `Failed to prepare model params: ${check.result.message}`,
      );
      return {
        success: false,
        error: check.result.message,
        reason: check.result.reason,
      };
    }
    return null;
  }

  private successResult(input: {
    context: ScenarioExecutionPrefetchInput["context"];
    target: TargetConfig;
    validated: Extract<ValidatedLookups, { success: true }>;
    models: Extract<ResolvedModels, { success: true }>;
    prepared: PreparedModels;
    traceWaitTimeoutMs: number | undefined;
  }): ScenarioExecutionPrefetchResult {
    const { context, target, validated, models, prepared, traceWaitTimeoutMs } = input;
    const modelParams = prepared.adapter?.success ? prepared.adapter.params : void 0;
    if (!prepared.simulator.success || !prepared.judge.success) {
      throw new Error("Prepared model results were not validated");
    }

    return {
      success: true,
      data: {
        context,
        scenario: validated.scenario.config,
        parameters: validated.scenario.parameters,
        adapterData: validated.adapter,
        modelParams,
        simulatorModelParams: prepared.simulator.params,
        judgeModelParams: prepared.judge.params,
        nlpServiceUrl: this.options.config.nlpServiceUrl,
        target,
        ...(traceWaitTimeoutMs !== void 0 ? { traceWaitTimeoutMs } : {}),
      },
      telemetry: {
        endpoint: this.options.config.langwatchEndpoint,
        apiKey: validated.project.apiKey,
      },
      // The names, not the params: the caller that queues the run records
      // which models it ran on, and reads them back off the run a month later.
      resolvedModels: { simulatorModel: models.simulator, judgeModel: models.judge },
    };
  }
}
