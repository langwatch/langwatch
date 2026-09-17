/**
 * The pod that actually RUNS a simulation. The simulation pipeline's `execute` intent has always
 * been mounted; what was missing everywhere in the tree was something for it to submit to.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentApi } from "@langwatch/agent-contract";
import type { EventingClickHouseClientResolver } from "@langwatch/eventing/server";
import { generate } from "@langwatch/ksuid";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { createLogger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { SimulationService } from "@langwatch/scenario-contract";
import { ScenarioService, type ScenarioAppInfrastructure } from "@langwatch/scenario-server";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import type { SuiteApi } from "@langwatch/suite-contract";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  NodeScenarioChildProcessAdapter,
  OtelScenarioProcessorMetricsAdapter,
  PostgresScenarioRepositories,
  RedisCancellationPublisherAdapter,
  RedisCancellationSubscriberAdapter,
  type ScenarioClock,
  ScenarioExecutionPoolService,
  ScenarioExecutionPrefetcherService,
  ScenarioExecutionService,
  ScenarioFailureHandlerService,
  type ScenarioId,
  ScenarioProcessorService,
  type ScenarioSecretCipher,
  type ScenarioTestSuiteId,
  type ScenarioEgressPolicy,
} from "@langwatch/scenario-server";
import { AesGcmSecretEncryptionAdapter } from "@langwatch/secret-server";
import type { TraceApi } from "@langwatch/trace-contract";
import type { NlpPayloadStaging } from "@langwatch/workflow-server";

import type { WorkerConfig } from "../platform/config/worker.config.ts";
import { nowInstant, toDate } from "@langwatch/time";

/**
 * Reports the composition decision an absent executor would otherwise hide. A worker that composes
 * no executor is not broken — the `execute` intent refuses into the outbox and another pod takes
 * the run.
 */
export abstract class WorkerScenarioExecutionAbsenceReport {
  abstract withoutExecutor(
    reason:
      | "no-clickhouse"
      | "no-model-gateway"
      | "no-redis"
      | "no-encryption-key"
      | "no-telemetry-endpoint"
      | "no-nlp-engine",
  ): void;
}

/** The ksuid resource prefix a scenario row is minted under, as the API mints it. */
const SCENARIO_KSUID_RESOURCE = "scenario";

/**
 * The app's KSUID resource for a test suite's folder id
 * (`KSUID_RESOURCES.SCENARIO_TEST_SUITE`), as the API mints it.
 */
const SCENARIO_TEST_SUITE_KSUID_RESOURCE = "suite";

export type WorkerScenarioExecutionCompositionInput = Readonly<{
  config: WorkerConfig;
  /** The one Prisma client this process opened. */
  database: PrismaClient;
  modelProviders: ModelProviderApi | undefined;
  projects: ProjectApi;
  redis: RedisConnection | null | undefined;
  resolveClickHouseClient: EventingClickHouseClientResolver | undefined;
  /**
   * The process's ONE routed query client, for the suite runtime's member —
   * NOT the per-tenant resolver above, which answers a different question.
   * Absent, the suite module refuses its clickhouse member by name at boot.
   */
  clickhouse?: ClickHouseQueryClient | undefined;
  defaultRetentionDays: number;
  /** Where an oversized NLP invoke body is parked; the absent one refuses by name. */
  payloadStaging: NlpPayloadStaging;
  absence?: WorkerScenarioExecutionAbsenceReport;
}>;

/** Everything an executor needs, once every optional above has answered. */
export type WorkerScenarioExecutionPrerequisites = Readonly<{
  config: WorkerConfig;
  database: PrismaClient;
  modelProviders: ModelProviderApi;
  projects: ProjectApi;
  redis: RedisConnection;
  resolveClickHouseClient: EventingClickHouseClientResolver;
  clickhouse?: ClickHouseQueryClient | undefined;
  defaultRetentionDays: number;
  langwatchEndpoint: string;
  nlpServiceUrl: string;
  encryptionKey: string;
  payloadStaging: NlpPayloadStaging;
}>;

/**
 * Whether this process can run simulations, decided ONCE and before anything is built.
 */
export function resolveWorkerScenarioExecutionPrerequisites(
  options: WorkerScenarioExecutionCompositionInput,
): WorkerScenarioExecutionPrerequisites | undefined {
  const langwatchEndpoint = options.config.infrastructure.execution.langwatchEndpoint;
  const nlpServiceUrl = options.config.infrastructure.modelProvider.nlpServiceUrl;
  const encryptionKey = options.config.automation.credentialsEncryptionKey;

  const { resolveClickHouseClient, modelProviders, projects, redis } = options;
  if (!resolveClickHouseClient) return refuse(options, "no-clickhouse");
  if (!modelProviders) return refuse(options, "no-model-gateway");
  if (!redis) return refuse(options, "no-redis");
  if (!encryptionKey) return refuse(options, "no-encryption-key");
  if (!langwatchEndpoint) return refuse(options, "no-telemetry-endpoint");
  if (!nlpServiceUrl) return refuse(options, "no-nlp-engine");

  return {
    config: options.config,
    database: options.database,
    modelProviders,
    projects,
    redis,
    resolveClickHouseClient,
    ...(options.clickhouse ? { clickhouse: options.clickhouse } : {}),
    defaultRetentionDays: options.defaultRetentionDays,
    langwatchEndpoint,
    nlpServiceUrl,
    encryptionKey,
    payloadStaging: options.payloadStaging,
  };
}

function refuse(
  options: WorkerScenarioExecutionCompositionInput,
  reason: Parameters<WorkerScenarioExecutionAbsenceReport["withoutExecutor"]>[0],
): undefined {
  options.absence?.withoutExecutor(reason);
  return undefined;
}

/**
 * The executor, over this process's own graph.
 */
export function createWorkerScenarioExecution(input: {
  prerequisites: WorkerScenarioExecutionPrerequisites;
  pool: ScenarioExecutionPoolService;
  simulations: SimulationService;
  graph: WorkerScenarioGraph;
  agents: AgentApi;
}) {
  const { prerequisites: deps, pool, simulations } = input;

  const execution = ScenarioExecutionService.create({
    pool,
    cancellations: RedisCancellationPublisherAdapter.create(deps.redis),
    prefetcher: input.graph.prefetcher,
    failures: ScenarioFailureHandlerService.create({
      agents: input.agents,
      simulations,
    }),
    simulations,
  });

  const processor = ScenarioProcessorService.create({
    execution,
    pool,
    // A dedicated connection: a client in subscribe mode can issue nothing
    // else, so sharing the queue's own would silence every other command this
    // process sends on it.
    cancellations: RedisCancellationSubscriberAdapter.create(deps.redis.duplicate()),
    childProcesses: NodeScenarioChildProcessAdapter.create({
      config: resolveChildProcessConfig(deps),
      pool,
    }),
    metrics: OtelScenarioProcessorMetricsAdapter.create(),
  });

  return { execution, processor };
}

/** Inputs for resolving a run, without starting its pool or cancellation channel. */
export type WorkerScenarioPrefetcherPrerequisites = Pick<
  WorkerScenarioExecutionPrerequisites,
  | "config"
  | "database"
  | "modelProviders"
  | "projects"
  | "resolveClickHouseClient"
  | "defaultRetentionDays"
  | "langwatchEndpoint"
  | "nlpServiceUrl"
  | "encryptionKey"
  | "payloadStaging"
>;

/** Shared services used by run execution, over the ONE graph this process booted. */
export interface WorkerScenarioGraph {
  scenarios: ScenarioService;
  /** The id, clock and cipher ports a run's stored parameters are read through. */
  scenarioPorts: Pick<ScenarioAppInfrastructure, "ids" | "testSuiteIds" | "clock" | "secretCipher">;
  prefetcher: ScenarioExecutionPrefetcherService;
}

/**
 * The peers a run resolves against. Every one is an application this process
 * already installed, taken rather than rebuilt: a second suite runtime, a
 * second dataset application or a second secret cipher would each answer a
 * different question from the one the api answers.
 */
export type WorkerScenarioGraphPeers = Readonly<{
  agents: AgentApi;
  prompts: PromptApi;
  secrets: SecretApi;
  suites: SuiteApi;
  traces: TraceApi;
  workflows: WorkflowApi;
}>;

export function createWorkerScenarioExecutionGraph(input: {
  prerequisites: WorkerScenarioPrefetcherPrerequisites;
  simulations: SimulationService;
  peers: WorkerScenarioGraphPeers;
}): WorkerScenarioGraph {
  const { prerequisites: deps, simulations, peers } = input;
  const encryption = AesGcmSecretEncryptionAdapter.create({ key: deps.encryptionKey });
  const secretCipher = new WorkerScenarioSecretCipher(encryption);

  const scenarioPorts = {
    ids: new KsuidScenarioId(),
    testSuiteIds: new KsuidScenarioTestSuiteId(),
    clock: new SystemScenarioClock(),
    secretCipher,
  };
  const scenarios = ScenarioService.create({
    repository: PostgresScenarioRepositories.create({ prisma: deps.database }).scenarios,
    simulations,
    ...scenarioPorts,
  });

  const prefetcher = ScenarioExecutionPrefetcherService.create({
    secretCipher,
    config: {
      langwatchEndpoint: deps.langwatchEndpoint,
      nlpServiceUrl: deps.nlpServiceUrl,
      legacyDefaultModel: deps.config.infrastructure.execution.defaultModel,
    },
    scenarios,
    suites: peers.suites,
    prompts: peers.prompts,
    agents: peers.agents,
    workflows: peers.workflows,
    projects: deps.projects,
    modelProviders: deps.modelProviders,
    secrets: peers.secrets,
    traces: peers.traces,
  });

  return { scenarios, scenarioPorts, prefetcher };
}

/**
 * How a child is started, and where its sources are. `packageRoot` is this application's own
 * directory, so the spawn resolves `dist/server/scenario-child-process.cjs` and the `tsx` fallback
 * against the tree the entrypoint actually lives in.
 */
function resolveChildProcessConfig(deps: WorkerScenarioExecutionPrerequisites) {
  const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
  return {
    packageRoot,
    sourcePath: path.join(packageRoot, "src", "scenario-child.entrypoint.ts"),
    sourceRoots: [path.join(packageRoot, "src")],
    nodeEnv: deps.config.nodeEnvironment,
    isSaas: deps.config.deployment.saas,
    egress: {
      blockLocal: deps.config.infrastructure.modelProvider.blockLocalHttpCalls,
      allowedHosts: [...deps.config.infrastructure.modelProvider.allowedProxyHosts],
    } satisfies ScenarioEgressPolicy,
    parentEnvironment: {
      path: process.env.PATH,
      home: process.env.HOME,
      user: process.env.USER,
      shell: process.env.SHELL,
      lang: process.env.LANG,
      lcAll: process.env.LC_ALL,
      term: process.env.TERM,
      nodeCompileCache: process.env.NODE_COMPILE_CACHE,
      corepackEnableDownloadPrompt: process.env.COREPACK_ENABLE_DOWNLOAD_PROMPT,
      nodeExtraCaCerts: process.env.NODE_EXTRA_CA_CERTS,
    },
  };
}

class KsuidScenarioId implements ScenarioId {
  next(): string {
    return generate(SCENARIO_KSUID_RESOURCE).toString();
  }
}

/** The folder id, in the `suite_` format the other tier reads. */
class KsuidScenarioTestSuiteId implements ScenarioTestSuiteId {
  next(): string {
    return generate(SCENARIO_TEST_SUITE_KSUID_RESOURCE).toString();
  }
}

class SystemScenarioClock implements ScenarioClock {
  now() {
    return toDate(nowInstant());
  }
}

/**
 * A scenario's stored secret, under the deployment's own cipher. The SAME AES-256-GCM key the API
 * tier writes with: a run's secret parameters are encrypted on one tier and decrypted on this one,
 * so a second key here would fail every run that carries one.
 */
class WorkerScenarioSecretCipher implements ScenarioSecretCipher {
  constructor(private readonly encryption: AesGcmSecretEncryptionAdapter) {}

  encrypt(plaintext: string): string {
    return this.encryption.encrypt(plaintext);
  }

  decrypt(ciphertext: string): string {
    return this.encryption.decrypt(ciphertext);
  }
}

/** Names the executor's absence in this process's own log. */
export class LoggedWorkerScenarioExecutionAbsence extends WorkerScenarioExecutionAbsenceReport {
  static create(serviceName: string): LoggedWorkerScenarioExecutionAbsence {
    return new LoggedWorkerScenarioExecutionAbsence(createLogger(serviceName));
  }

  private constructor(private readonly logger: ReturnType<typeof createLogger>) {
    super();
  }

  withoutExecutor(
    reason: Parameters<WorkerScenarioExecutionAbsenceReport["withoutExecutor"]>[0],
  ): void {
    this.logger.warn(
      { reason },
      "worker composed no scenario executor: the simulation pipeline's execute intent refuses a queued run into the outbox, and the run starts only once a pod that composes one takes it",
    );
  }
}
