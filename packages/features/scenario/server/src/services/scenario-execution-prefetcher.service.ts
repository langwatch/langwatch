import type { AgentService } from "@langwatch/agent-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectService } from "@langwatch/project-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import type {
  RunSecretCiphertext,
  ScenarioExecutionPrefetchInput,
  ScenarioExecutionPrefetchResult,
  ScenarioExecutionPreparation,
  ScenarioService,
} from "@langwatch/scenario-contract";
import type { SecretService } from "@langwatch/secret-contract";
import type { SuiteService } from "@langwatch/suite-contract";
import type { TraceService } from "@langwatch/trace-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";

import { ScenarioExecutionLookupService } from "./scenario-execution-lookup.service";
import type { ModelParamsFailureReason } from "./scenario-model-parameters.service";
import { ScenarioModelParametersService } from "./scenario-model-parameters.service";
import {
  ScenarioPrefetchCompletionService,
  type ScenarioPrefetchLookups,
} from "./scenario-prefetch-completion.service";
import { ScenarioTargetPrefetchService } from "./scenario-target-prefetch.service";
import type { ScenarioSecretCipherPort } from "../ports/scenario-secret-cipher.port";
import { ScenarioRunSecretsService } from "./scenario-run-secrets.service";
import { ScenarioWorkflowHydratorService } from "./scenario-workflow-hydrator.service";

export type {
  ModelParamsFailureReason,
  ModelParamsResult,
} from "./scenario-model-parameters.service";

const logger = createLogger("langwatch:scenarios:data-prefetcher");

/** Typed boot configuration needed to prepare one isolated scenario child. */
export interface ScenarioExecutionPrefetchConfig {
  langwatchEndpoint: string;
  nlpServiceUrl: string;
  legacyDefaultModel: string;
}

type ScenarioExecutionPrefetcherServiceOptions = {
  secretCipher: ScenarioSecretCipherPort;
  config: ScenarioExecutionPrefetchConfig;
  scenarios: ScenarioService;
  suites: SuiteService;
  prompts: PromptService;
  agents: AgentService;
  workflows: WorkflowService;
  projects: ProjectService;
  modelProviders: ModelProviderService;
  secrets: SecretService;
  traces: TraceService;
};

type DecryptedRunSecrets =
  | { success: true; values: Record<string, string> }
  | { success: false; error: string };

export class ScenarioExecutionPrefetcherService {
  static create(
    options: ScenarioExecutionPrefetcherServiceOptions,
  ): ScenarioExecutionPrefetcherService {
    const modelParameters = ScenarioModelParametersService.create(options.modelProviders);
    const lookups = ScenarioExecutionLookupService.create({
      scenarios: options.scenarios,
      projects: options.projects,
      suites: options.suites,
      modelProviders: options.modelProviders,
    });
    const workflowHydrator = ScenarioWorkflowHydratorService.create(modelParameters);
    const targets = ScenarioTargetPrefetchService.create({
      prompts: options.prompts,
      agents: options.agents,
      workflows: options.workflows,
      secrets: options.secrets,
      workflowHydrator,
      legacyDefaultModel: options.config.legacyDefaultModel,
    });
    const completion = ScenarioPrefetchCompletionService.create({
      config: options.config,
      lookups,
      modelParameters,
      traces: options.traces,
    });
    const runSecrets = ScenarioRunSecretsService.create(options.secretCipher);

    return new ScenarioExecutionPrefetcherService(
      options,
      runSecrets,
      lookups,
      targets,
      completion,
    );
  }

  private constructor(
    private readonly options: ScenarioExecutionPrefetcherServiceOptions,
    private readonly runSecrets: ScenarioRunSecretsService,
    private readonly lookups: ScenarioExecutionLookupService,
    private readonly targets: ScenarioTargetPrefetchService,
    private readonly completion: ScenarioPrefetchCompletionService,
  ) {}

  prefetch(
    input: ScenarioExecutionPrefetchInput,
  ): Promise<ScenarioExecutionPrefetchResult> {
    return this.prepare(input).result;
  }

  prepare(input: ScenarioExecutionPrefetchInput): ScenarioExecutionPreparation {
    const { context, target } = input;
    logger.debug(
      {
        projectId: context.projectId,
        scenarioId: context.scenarioId,
        batchRunId: context.batchRunId,
        targetType: target.type,
      },
      "Prefetching scenario data",
    );

    const runSecrets = this.decryptRunSecrets(context.secretParameters);
    if (!runSecrets.success) {
      return this.failedPreparation(runSecrets.error);
    }

    const lookups = this.startLookups(input, runSecrets.values);
    return {
      childEnvironment: Promise.all([lookups.scenario, lookups.project])
        .then(([scenario, project]) => {
          if (!scenario || !project.success) {
            return null;
          }
          return {
            labels: scenario.config.labels,
            telemetry: {
              endpoint: this.options.config.langwatchEndpoint,
              apiKey: project.data.apiKey,
            },
          };
        })
        .catch(() => null),
      result: this.completion.complete({ context, target, lookups }),
    };
  }

  private decryptRunSecrets(
    ciphertext: RunSecretCiphertext | undefined,
  ): DecryptedRunSecrets {
    if (!ciphertext || Object.keys(ciphertext).length === 0) {
      return { success: true, values: {} };
    }

    try {
      return { success: true, values: this.runSecrets.decrypt(ciphertext) };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private failedPreparation(error: string): ScenarioExecutionPreparation {
    return {
      childEnvironment: Promise.resolve(null),
      result: Promise.resolve({ success: false, error }),
    };
  }

  private startLookups(
    input: ScenarioExecutionPrefetchInput,
    runSecretValues: Record<string, string>,
  ): ScenarioPrefetchLookups {
    const { context, target } = input;
    return {
      scenario: this.lookups.tryFetchScenario({
        projectId: context.projectId,
        scenarioId: context.scenarioId,
        suppliedParameters: context.parameters,
      }),
      project: this.lookups.fetchProject(context.projectId),
      adapter: this.targets.tryFetch({
        projectId: context.projectId,
        target,
        runSecretValues,
      }),
      suite: this.lookups.tryFetchSuite(context.setId, context.projectId),
    };
  }
}
