import type { AgentApi } from "@langwatch/agent-contract";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { DEFAULT_MODEL, type ModelProviderApi } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import type { ResourceOwnership } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { ScenarioServerConfig, SimulationService } from "@langwatch/scenario-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import type { TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import type { CancellationPublisher, CancellationSubscriber } from "../app/scenario.app.ts";
import type {
  ScenarioChildChannel,
  ScenarioGoChildChannel,
} from "../channels/scenario-child.channel.ts";
import { ScenarioChildChoiceService } from "../features/child/services/scenario-child-choice.service.ts";
import { ScenarioExecutionPrefetcherService } from "../features/prefetch/services/scenario-execution-prefetcher.service.ts";
import { ScenarioVoiceTargetService } from "../features/voice/services/scenario-voice-target.service.ts";
import type { VoiceNonceRegistryService } from "../features/voice/services/voice-nonce-registry.service.ts";
import type { VoicePublicUrl } from "../features/voice/services/voice-public-url.service.ts";
import type { ScenarioRunSecretSeal } from "../repositories/scenario.repository.ts";
import type { ScenarioExecutionPoolService } from "./scenario-execution-pool.service.ts";
import { ScenarioExecutionService } from "./scenario-execution.service.ts";
import { ScenarioFailureHandlerService } from "./scenario-failure-handler.service.ts";
import { ScenarioProcessorMetricsService } from "./scenario-processor-metrics.service.ts";
import { ScenarioProcessorService } from "./scenario-processor.service.ts";
import type { ScenarioService } from "./scenario.service.ts";

const logger = createLogger("langwatch:scenarios:executor");

/** The peers a run resolves against: the same applications the api reads. */
type ScenarioExecutorPeers = Readonly<{
  agents: AgentApi;
  prompts: PromptApi;
  secrets: SecretApi;
  traces: TraceApi;
  workflows: WorkflowApi;
  projects: ProjectApi;
  modelProviders: ModelProviderApi;
  apiKeys: ApiKeyApi;
  gateway: GatewayApi;
  featureFlags: FeatureFlagApi;
}>;

/** The process facts a child is started with, as the module resolved them. */
type ScenarioExecutorHost = Readonly<{
  /** Acquires the worker's public media origin on the first voice run. */
  voicePublicUrl: () => Promise<VoicePublicUrl>;
  nlpServiceUrl: string | undefined;
}>;

type ScenarioExecutorInput = Readonly<{
  /** The worker's one nonce registry, shared with its media door. */
  voiceNonces: VoiceNonceRegistryService;
  /** The child channels a run starts on; the choice between them is made per run. */
  children: Readonly<{ node: ScenarioChildChannel; go: ScenarioGoChildChannel }>;
  peers: ScenarioExecutorPeers;
  scenarios: ScenarioService;
  simulations: SimulationService;
  runSecretSeal: ScenarioRunSecretSeal;
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
      runSecretSeal: this.input.runSecretSeal,
      config: {
        langwatchEndpoint,
        nlpServiceUrl,
        legacyDefaultModel: config.defaultModel ?? DEFAULT_MODEL,
      },
      scenarios: this.input.scenarios,
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
      childProcesses: this.#childProcesses(pool),
      metrics: ScenarioProcessorMetricsService.create(),
    });
  }

  #childProcesses(pool: ScenarioExecutionPoolService): ScenarioChildChoiceService {
    return ScenarioChildChoiceService.create({
      node: this.input.children.node,
      go: this.input.children.go,
      featureFlags: this.input.peers.featureFlags,
      pool,
      nonces: this.input.voiceNonces,
      voicePublicUrl: this.input.host.voicePublicUrl,
    });
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
