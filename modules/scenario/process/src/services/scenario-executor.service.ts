import path from "node:path";

import type { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { DEFAULT_MODEL, type ModelProviderApi } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import type { ResourceOwnership } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
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
import {
  NodeScenarioChildService,
  type ScenarioChildProcessConfig,
} from "./node-scenario-child.service.ts";
import type { ScenarioExecutionPoolService } from "./scenario-execution-pool.service.ts";
import { ScenarioExecutionPrefetcherService } from "./scenario-execution-prefetcher.service.ts";
import { ScenarioExecutionService } from "./scenario-execution.service.ts";
import { ScenarioFailureHandlerService } from "./scenario-failure-handler.service.ts";
import { ScenarioProcessorMetricsService } from "./scenario-processor-metrics.service.ts";
import { ScenarioProcessorService } from "./scenario-processor.service.ts";
import { ScenarioVoiceTargetService } from "./scenario-voice-target.service.ts";
import type { ScenarioService } from "./scenario.service.ts";
import type { VoiceNonceRegistryService } from "./voice-nonce-registry.service.ts";
import type { VoicePublicUrl } from "./voice-public-url.service.ts";

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
  apiKeys: ApiKeyApi;
  gateway: GatewayApi;
}>;

/** The repository root: this file sits five folders below it, in source and in dist alike. */
const WORKSPACE_ROOT = path.join(import.meta.dirname, "..", "..", "..", "..", "..");
const CHILD_PACKAGE_ROOT = path.join(WORKSPACE_ROOT, "apps", "scenario-child");

/** The process facts a child is started with, read as members. */
export type ScenarioExecutorHost = Readonly<{
  voicePublicUrl: VoicePublicUrl;
  nlpServiceUrl: string | undefined;
  /** The engine hop's shared credential, as the process resolved it. */
  nlpInternalSecret: string | undefined;
  isSaas: boolean;
  nodeEnvironment: string | undefined;
  publicBaseUrl: string | undefined;
}>;

type ScenarioExecutorInput = Readonly<{
  /** The worker's one nonce registry, shared with its media door. */
  voiceNonces: VoiceNonceRegistryService;
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
      apiKeys: peers.apiKeys,
      voiceTargets: ScenarioVoiceTargetService.create({
        agents: peers.agents,
        modelProviders: peers.modelProviders,
        gateway: peers.gateway,
        voiceCallMaxSeconds: config.voiceCallMaxSeconds,
      }),
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
      childProcesses: NodeScenarioChildService.create({
        config: this.#childConfig(),
        pool,
        nonces: this.input.voiceNonces,
      }),
      metrics: ScenarioProcessorMetricsService.create(),
    });
  }

  #childConfig(): ScenarioChildProcessConfig {
    return ScenarioExecutorService.childConfig({
      config: this.input.config,
      host: this.input.host,
    });
  }

  /** How a scenario child is started here, whether it runs a simulation or one agent-test turn. */
  static childConfig({
    config,
    host,
  }: {
    config: ScenarioServerConfig;
    host: ScenarioExecutorHost;
  }): ScenarioChildProcessConfig {
    return {
      packageRoot: CHILD_PACKAGE_ROOT,
      sourcePath: path.join(CHILD_PACKAGE_ROOT, "src", "main.ts"),
      sourceRoots: [
        path.join(CHILD_PACKAGE_ROOT, "src"),
        path.join(WORKSPACE_ROOT, "modules", "scenario", "contract", "src"),
        path.join(WORKSPACE_ROOT, "modules", "scenario", "process", "src", "channels"),
      ],
      nodeEnv: host.nodeEnvironment,
      isSaas: host.isSaas,
      voicePublicUrl: host.voicePublicUrl,
      baseHost: host.publicBaseUrl,
      egress: {
        blockLocal: config.blockLocalHttpCalls,
        allowedHosts: [...config.allowedProxyHosts],
      },
      nlpInternalSecret: host.nlpInternalSecret,
      parentEnvironment: config.childParentEnvironment,
    };
  }

  #withoutExecutor(reason: "no-telemetry-endpoint" | "no-nlp-engine"): void {
    logger.warn(
      { reason },
      "worker composed no scenario executor: the simulation pipeline's execute intent " +
        "refuses a queued run into the outbox, and the run starts only once a pod that " +
        "composes one takes it",
    );
  }
}
