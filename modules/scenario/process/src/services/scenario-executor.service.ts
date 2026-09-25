import type { AgentApi } from "@langwatch/agent-contract";
import type { ResourceOwnership } from "@langwatch/kernel";
import { DEFAULT_MODEL, type ModelProviderApi } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import {
  scenarioChildPackageRoot,
  scenarioChildSourcePath,
  scenarioChildSourceRoots,
} from "@langwatch/scenario-child";
import type { ScenarioServerConfig, SimulationService } from "@langwatch/scenario-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import type { SuiteApi } from "@langwatch/suite-contract";
import type { TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import type {
  CancellationPublisher,
  CancellationSubscriber,
  ScenarioSecretCipher,
} from "../app/scenario.app.ts";
import { nlpFetchChannels } from "../channels/nlp-fetch-channels.registry.ts";
import {
  NodeScenarioChildProcessAdapter,
  type ScenarioChildProcessConfig,
} from "./node-scenario-child-process.service.ts";
import type { ScenarioExecutionPoolService } from "./scenario-execution-pool.service.ts";
import { ScenarioExecutionPrefetcherService } from "./scenario-execution-prefetcher.service.ts";
import { ScenarioExecutionService } from "./scenario-execution.service.ts";
import { ScenarioFailureHandlerService } from "./scenario-failure-handler.service.ts";
import { OtelScenarioProcessorMetricsAdapter } from "./scenario-processor-metrics.service.ts";
import { ScenarioProcessorService } from "./scenario-processor.service.ts";
import type { ScenarioService } from "./scenario.service.ts";

const logger = createLogger("langwatch:scenarios:executor");

/** The peers a run resolves against: the same applications the api reads. */
export type ScenarioExecutorPeers = Readonly<{
  agents: AgentApi;
  prompts: PromptApi;
  secrets: SecretApi;
  suites: SuiteApi;
  traces: TraceApi;
  workflows: WorkflowApi;
  projects: ProjectApi;
  modelProviders: ModelProviderApi;
}>;

/** The process facts a child is started with, read as members. */
export type ScenarioExecutorHost = Readonly<{
  nlpServiceUrl: string | undefined;
  isSaas: boolean;
  nodeEnvironment: string | undefined;
  publicBaseUrl: string | undefined;
}>;

type ScenarioExecutorInput = Readonly<{
  peers: ScenarioExecutorPeers;
  scenarios: ScenarioService;
  simulations: SimulationService;
  secretCipher: ScenarioSecretCipher;
  cancellations: CancellationPublisher;
  cancellationSubscriptions: CancellationSubscriber;
  config: ScenarioServerConfig;
  host: ScenarioExecutorHost;
}>;

/**
 * The runner a consuming pool drains into, ported from main's
 * worker-scenario-execution.composition.ts: prefetcher, execution, and the
 * processor that spawns one isolated child per run.
 */
export class ScenarioExecutorService {
  private constructor(private readonly input: ScenarioExecutorInput) {}

  static create(input: ScenarioExecutorInput): ScenarioExecutorService {
    return new ScenarioExecutorService(input);
  }

  /** Connects the pool's runner, and owns its drain where the process hands an owner. */
  connect({
    pool,
    resources,
  }: {
    pool: ScenarioExecutionPoolService;
    resources: Pick<ResourceOwnership, "own"> | undefined;
  }): void {
    const { langwatchEndpoint } = this.input.config;
    const { nlpServiceUrl } = this.input.host;
    if (!langwatchEndpoint) return this.#withoutExecutor("no-telemetry-endpoint");
    if (!nlpServiceUrl) return this.#withoutExecutor("no-nlp-engine");

    const processor = this.#processor({ pool, langwatchEndpoint, nlpServiceUrl });
    const running = processor.start();
    running.catch((error: unknown) => {
      logger.error({ error }, "scenario executor could not subscribe to cancellations");
    });
    resources?.own("scenario executor", async () => {
      const started = await running.catch(() => void 0);
      await started?.close();
      await nlpFetchChannels.live.create().close();
    });
  }

  #processor({
    pool,
    langwatchEndpoint,
    nlpServiceUrl,
  }: {
    pool: ScenarioExecutionPoolService;
    langwatchEndpoint: string;
    nlpServiceUrl: string;
  }): ScenarioProcessorService {
    const { peers, config, simulations } = this.input;
    const prefetcher = ScenarioExecutionPrefetcherService.create({
      secretCipher: this.input.secretCipher,
      config: {
        langwatchEndpoint,
        nlpServiceUrl,
        legacyDefaultModel: config.defaultModel ?? DEFAULT_MODEL,
      },
      scenarios: this.input.scenarios,
      suites: peers.suites,
      prompts: peers.prompts,
      agents: peers.agents,
      workflows: peers.workflows,
      projects: peers.projects,
      modelProviders: peers.modelProviders,
      secrets: peers.secrets,
      traces: peers.traces,
      voiceTargets: null,
    });
    const execution = ScenarioExecutionService.create({
      pool,
      cancellations: this.input.cancellations,
      prefetcher,
      failures: ScenarioFailureHandlerService.create({ agents: peers.agents, simulations }),
      simulations,
    });
    return ScenarioProcessorService.create({
      execution,
      pool,
      cancellations: this.input.cancellationSubscriptions,
      childProcesses: NodeScenarioChildProcessAdapter.create({ config: this.#childConfig(), pool }),
      metrics: OtelScenarioProcessorMetricsAdapter.create(),
    });
  }

  #childConfig(): ScenarioChildProcessConfig {
    const { config, host } = this.input;
    return {
      packageRoot: scenarioChildPackageRoot,
      sourcePath: scenarioChildSourcePath,
      sourceRoots: scenarioChildSourceRoots,
      nodeEnv: host.nodeEnvironment,
      isSaas: host.isSaas,
      voicePublicBaseUrl: config.voicePublicBaseUrl,
      baseHost: host.publicBaseUrl,
      egress: {
        blockLocal: config.blockLocalHttpCalls,
        allowedHosts: [...config.allowedProxyHosts],
      },
      parentEnvironment: config.childParentEnvironment,
    };
  }

  #withoutExecutor(reason: "no-telemetry-endpoint" | "no-nlp-engine"): void {
    logger.warn(
      { reason },
      "worker composed no scenario executor: the simulation pipeline's execute intent refuses a queued run into the outbox, and the run starts only once a pod that composes one takes it",
    );
  }
}
