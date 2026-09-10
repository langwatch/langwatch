/**
 * The pod that actually RUNS a simulation. The simulation pipeline's `execute` intent has always
 * been mounted; what was missing everywhere in the tree was something for it to submit to.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { AgentApi } from "@langwatch/agent-contract";
import { createWorkerDatasetApp } from "./worker-dataset-normalization.composition.ts";
import type { DatasetService } from "@langwatch/dataset-contract";
import type { EventingClickHouseClientResolver } from "@langwatch/eventing/server";
import { generate } from "@langwatch/ksuid";
import { getProjectModelProviders } from "@langwatch/model-provider-server";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import type { PrismaConnection } from "@langwatch/prisma-client";
import { ProjectApi } from "@langwatch/project-contract";
import { PostgresPromptAdapter, PromptApp } from "@langwatch/prompt-server";
import type { RedisConnection } from "@langwatch/redis-client";
import { ScenarioApi } from "@langwatch/scenario-contract";
import type { SimulationService } from "@langwatch/scenario-contract";
import { ScenarioService } from "@langwatch/scenario-server";
import { PromptApi } from "@langwatch/prompt-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import type { SuiteApi } from "@langwatch/suite-contract";
import { createApp, type ResourceScope } from "@langwatch/runtime-composition";
import {
  NodeScenarioChildProcessAdapter,
  OtelScenarioProcessorMetricsAdapter,
  PostgresScenarioRepositories,
  RedisCancellationPublisherAdapter,
  RedisCancellationSubscriberAdapter,
  ScenarioClockPort,
  ScenarioExecutionPoolService,
  ScenarioExecutionPrefetcherService,
  ScenarioExecutionService,
  ScenarioFailureHandlerService,
  ScenarioIdPort,
  ScenarioProcessorService,
  ScenarioSecretCipherPort,
  ScenarioTestSuiteIdPort,
  type ScenarioEgressPolicy,
} from "@langwatch/scenario-server";
import { AesGcmSecretEncryptionAdapter, secretServer } from "@langwatch/secret-server";
import { suiteServer, SuiteExecutionPort } from "@langwatch/suite-server";
import type { TraceApi } from "@langwatch/trace-contract";
import {
  ContractWorkflowDslMigrationAdapter,
  HttpWorkflowNlpRuntimeAdapter,
  NlpPayloadStagingPort,
  PostgresWorkflowAdapter,
  PrismaWorkflowProjectEnvironmentAdapter,
  WorkflowLlmParametersPort,
  type WorkflowNlpRuntimePort,
  type WorkflowLlmParameterResolution, type WorkflowService,} from "@langwatch/workflow-server";
import type { LLMConfig } from "@langwatch/workflow-contract";
import { nanoid } from "nanoid";

import type { WorkerConfig } from "../platform/config/worker.config.ts";
import { nowInstant, toDate } from "@langwatch/time";

/**
 * Reports the composition decision an absent executor would otherwise hide. A worker that composes
 * no executor is not broken — the `execute` intent refuses into the outbox and another pod takes
 * the run.
 */
export abstract class WorkerScenarioExecutionAbsenceReportPort {
  abstract withoutExecutor(
    reason:
      | "no-typed-prisma-connection"
      | "no-clickhouse"
      | "no-model-gateway"
      | "no-tenancy"
      | "no-redis"
      | "no-encryption-key"
      | "no-telemetry-endpoint"
      | "no-nlp-engine",
  ): void;
}

/** The ksuid resource prefix a scenario row is minted under, as the API mints it. */
const SCENARIO_KSUID_RESOURCE = "scenario";

export type WorkerScenarioExecutionCompositionInput = Readonly<{
  config: WorkerConfig;
  connection: PrismaConnection | undefined;
  modelProviders: ModelProviderApi | undefined;
  projects: ProjectApi | undefined;
  redis: RedisConnection | null | undefined;
  resolveClickHouseClient: EventingClickHouseClientResolver | undefined;
  defaultRetentionDays: number;
  /** Where an oversized NLP invoke body is parked; the absent one refuses by name. */
  payloadStaging: NlpPayloadStagingPort;
  absence?: WorkerScenarioExecutionAbsenceReportPort;
}>;

/** Everything an executor needs, once every optional above has answered. */
export type WorkerScenarioExecutionPrerequisites = Readonly<{
  config: WorkerConfig;
  connection: PrismaConnection;
  modelProviders: ModelProviderApi;
  projects: ProjectApi;
  redis: RedisConnection;
  resolveClickHouseClient: EventingClickHouseClientResolver;
  defaultRetentionDays: number;
  langwatchEndpoint: string;
  nlpServiceUrl: string;
  encryptionKey: string;
  payloadStaging: NlpPayloadStagingPort;
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

  const { connection, resolveClickHouseClient, modelProviders, projects, redis } = options;
  if (!connection) return refuse(options, "no-typed-prisma-connection");
  if (!resolveClickHouseClient) return refuse(options, "no-clickhouse");
  if (!modelProviders) return refuse(options, "no-model-gateway");
  if (!projects) return refuse(options, "no-tenancy");
  if (!redis) return refuse(options, "no-redis");
  if (!encryptionKey) return refuse(options, "no-encryption-key");
  if (!langwatchEndpoint) return refuse(options, "no-telemetry-endpoint");
  if (!nlpServiceUrl) return refuse(options, "no-nlp-engine");

  return {
    config: options.config,
    connection,
    modelProviders,
    projects,
    redis,
    resolveClickHouseClient,
    defaultRetentionDays: options.defaultRetentionDays,
    langwatchEndpoint,
    nlpServiceUrl,
    encryptionKey,
    payloadStaging: options.payloadStaging,
  };
}

function refuse(
  options: WorkerScenarioExecutionCompositionInput,
  reason: Parameters<WorkerScenarioExecutionAbsenceReportPort["withoutExecutor"]>[0],
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
  | "connection"
  | "modelProviders"
  | "projects"
  | "resolveClickHouseClient"
  | "defaultRetentionDays"
  | "langwatchEndpoint"
  | "nlpServiceUrl"
  | "encryptionKey"
  | "payloadStaging"
>;

/** Shared services used by ScenarioApp and run execution. */
export interface WorkerScenarioGraph {
  scenarios: ScenarioService;
  prompts: PromptService;
  suites: SuiteApi;
  workflows: WorkflowService;
  datasets: DatasetService;
  nlpRuntime: WorkflowNlpRuntimePort;
  secrets: SecretApi;
  prefetcher: ScenarioExecutionPrefetcherService;
}

export async function createWorkerScenarioExecutionGraph(input: {
  prerequisites: WorkerScenarioPrefetcherPrerequisites;
  simulations: SimulationService;
  scenarioApi: ScenarioApi;
  traces: TraceApi;
  agents: AgentApi;
  resources: ResourceScope;
}): Promise<WorkerScenarioGraph> {
  const { prerequisites: deps, simulations } = input;
  const prisma = deps.connection.client;
  const encryption = AesGcmSecretEncryptionAdapter.create({ key: deps.encryptionKey });
  const secretCipher = new WorkerScenarioSecretCipher(encryption);

  const scenarios = ScenarioService.create({
    repository: PostgresScenarioRepositories.create({ prisma }).scenarios,
    simulations,
    ids: new KsuidScenarioId(),
    testSuiteIds: new NanoidScenarioTestSuiteId(),
    clock: new SystemScenarioClock(),
    secretCipher,
  });

  const prompts = PostgresPromptAdapter.create({
    database: prisma,
    modelProvider: deps.modelProviders,
  }).build();

  const agents = input.agents;
  const promptApp = PromptApp.create({ prompts, projects: deps.projects });

  // The suite application, over the feature's own repositories. This process
  // starts no run — the refusal below says so by name — but it reads the plans
  // and the run projection a scenario child reports against.
  const suiteRuntime = await createApp({ name: "langwatch-worker-suite" })
    .withPersistence("postgres", { prisma })
    .withInfrastructure({})
    .withProvided(ScenarioApi, input.scenarioApi)
    .withProvided(AgentApi, agents)
    .withProvided(PromptApi, promptApp)
    .withProvided(ProjectApi, deps.projects)
    .withModule(suiteServer, {
      infrastructure: {
        resolveClickHouseClient: deps.resolveClickHouseClient,
        defaultRetentionDays: deps.defaultRetentionDays,
        execution: new WorkerSuiteStartRefusal(deps.config.serviceName),
        generateId: () => `suite_${nanoid()}`,
      },
    })
    .boot({ role: "worker" });
  input.resources.own("worker scenario suites", () => suiteRuntime.stop());
  const suites = suiteRuntime.module(suiteServer).provided;

  const datasets = await createWorkerDatasetApp({ database: prisma, resources: input.resources });
  const nlpRuntime = HttpWorkflowNlpRuntimeAdapter.create({
    serviceUrl: deps.nlpServiceUrl,
    staging: deps.payloadStaging,
  });
  const workflows = PostgresWorkflowAdapter.create({
    database: prisma,
    datasets,
    modelProviders: deps.modelProviders,
    nlpRuntime,
    projectEnvironment: PrismaWorkflowProjectEnvironmentAdapter.create({
      database: prisma,
      encryption,
    }),
    llmParameters: WorkerWorkflowLlmParameters.create({ modelProviders: deps.modelProviders }),
    dslMigration: ContractWorkflowDslMigrationAdapter.create(),
  });

  // The SAME cipher the child processes decrypt a run's parameters with, over this
  // pod's own connection: the secret feature owns the reserved-name list itself now.
  const secretRuntime = await createApp({ name: "langwatch-worker-secret" })
    .withPersistence("postgres", { prisma })
    .withInfrastructure({})
    .withModule(secretServer, { infrastructure: { encryption } })
    .boot({ role: "worker" });
  input.resources.own("worker scenario secrets", () => secretRuntime.stop());
  const secrets = secretRuntime.module(secretServer).provided;

  const prefetcher = ScenarioExecutionPrefetcherService.create({
    secretCipher,
    config: {
      langwatchEndpoint: deps.langwatchEndpoint,
      nlpServiceUrl: deps.nlpServiceUrl,
      legacyDefaultModel: deps.config.infrastructure.execution.defaultModel,
    },
    scenarios,
    suites,
    prompts,
    agents,
    workflows,
    projects: deps.projects,
    modelProviders: deps.modelProviders,
    secrets,
    traces: input.traces,
  });

  return { scenarios, prompts, suites, workflows, datasets, nlpRuntime, secrets, prefetcher };
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

class KsuidScenarioId extends ScenarioIdPort {
  next(): string {
    return generate(SCENARIO_KSUID_RESOURCE).toString();
  }
}

/** The folder id, in the `suite_` format the other tier reads. */
class NanoidScenarioTestSuiteId extends ScenarioTestSuiteIdPort {
  next(): string {
    return `suite_${nanoid()}`;
  }
}

class SystemScenarioClock extends ScenarioClockPort {
  now() {
    return toDate(nowInstant());
  }
}

/**
 * A scenario's stored secret, under the deployment's own cipher. The SAME AES-256-GCM key the API
 * tier writes with: a run's secret parameters are encrypted on one tier and decrypted on this one,
 * so a second key here would fail every run that carries one.
 */
class WorkerScenarioSecretCipher extends ScenarioSecretCipherPort {
  constructor(private readonly encryption: AesGcmSecretEncryptionAdapter) {
    super();
  }

  encrypt(plaintext: string): string {
    return this.encryption.encrypt(plaintext);
  }

  decrypt(ciphertext: string): string {
    return this.encryption.decrypt(ciphertext);
  }
}

/**
 * Starting a suite run, on the process that DRAINS suite runs. Refused rather than composed: the
 * start is a browser write dispatched on the API's own producer, and this process reads a suite
 * only to resolve the plan overrides a simulation already in flight was configured with.
 */
class WorkerSuiteStartRefusal extends SuiteExecutionPort {
  constructor(private readonly processName: string) {
    super();
  }

  execute(input: { suiteId: string }): Promise<never> {
    return Promise.reject(
      new Error(
        `${this.processName} composes no suite start; suiteId=${input.suiteId} must be started through the API.`,
      ),
    );
  }
}

/**
 * Which of a workflow's models this project can actually run, and why not. Three outcomes rather
 * than two, exactly as the API tier resolves them: a provider the project never configured, one
 * configured and switched off, and one that is on and hands back prepared credentials.
 */
class WorkerWorkflowLlmParameters extends WorkflowLlmParametersPort {
  static create(input: { modelProviders: ModelProviderApi }): WorkerWorkflowLlmParameters {
    return new WorkerWorkflowLlmParameters(input.modelProviders);
  }

  private constructor(private readonly modelProviders: ModelProviderApi) {
    super();
  }

  async resolve(input: {
    projectId: string;
    models: readonly LLMConfig["model"][];
  }): Promise<readonly WorkflowLlmParameterResolution[]> {
    const providers = await getProjectModelProviders(this.modelProviders, input.projectId);

    return await Promise.all(
      input.models.map(async (model) => {
        const provider = model.split("/")[0]!;
        const modelProvider = providers[provider];
        if (!modelProvider) {
          return { model, provider, configured: false, enabled: false };
        }
        if (!modelProvider.enabled) {
          return { model, provider, configured: true, enabled: false };
        }
        return {
          model,
          provider,
          configured: true,
          enabled: true,
          litellmParams: await this.modelProviders.prepareExecution({
            model,
            projectId: input.projectId,
          }),
        };
      }),
    );
  }
}

/** Names the executor's absence in this process's own log. */
export class LoggedWorkerScenarioExecutionAbsence extends WorkerScenarioExecutionAbsenceReportPort {
  static create(serviceName: string): LoggedWorkerScenarioExecutionAbsence {
    return new LoggedWorkerScenarioExecutionAbsence(createLogger(serviceName));
  }

  private constructor(private readonly logger: ReturnType<typeof createLogger>) {
    super();
  }

  withoutExecutor(
    reason: Parameters<WorkerScenarioExecutionAbsenceReportPort["withoutExecutor"]>[0],
  ): void {
    this.logger.warn(
      { reason },
      "worker composed no scenario executor: the simulation pipeline's execute intent refuses a queued run into the outbox, and the run starts only once a pod that composes one takes it",
    );
  }
}
