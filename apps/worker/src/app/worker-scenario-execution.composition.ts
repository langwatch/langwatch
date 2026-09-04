/**
 * The pod that actually RUNS a simulation.
 *
 * The simulation pipeline's `execute` intent has always been mounted; what was
 * missing everywhere in the tree was something for it to submit to. This
 * composition is that something: an in-process pool, the processor that drains
 * it, and the run preparer the processor asks for a target before it spawns a
 * child.
 *
 *     simulationRunExecutionPM  execute intent
 *       `- ScenarioExecutionService.submit
 *            `- ScenarioExecutionPoolService     concurrency, cancellation
 *                 `- ScenarioProcessorService    one child per run
 *                      |- prepare / prefetch     eleven collaborators, below
 *                      |- NodeScenarioChildProcessAdapter
 *                      `- finishUnsuccessfulRun  back into this pipeline
 *
 * PREPARING A RUN REACHES ELEVEN VERTICALS, and this process composes all of
 * them from its own Postgres client and its own routed ClickHouse: the
 * scenario and its stored secrets, the suite whose plan may override the two
 * simulation models, the prompt, agent, workflow and project directories, the
 * model gateway all three roles resolve on, the project secret store a run's
 * secret parameters are decrypted from, and the trace reads an HTTP target's
 * ingest wait is measured against. A pool wired to a preparer that could not
 * answer would fail every run at execution time instead of at boot, which is
 * why the whole set is a precondition rather than a set of optionals.
 *
 * ONE thing here refuses by name, and it is a door rather than a capability:
 * STARTING a suite run. That is the API's write path — the browser posts it,
 * the API dispatches `startSuiteRun` on its own producer, and this process
 * drains it. A suite service that could start one from here would be a second
 * door onto one command.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { PostgresAgentAdapter } from "@langwatch/agent-server";
import { PostgresDatasetAdapter } from "@langwatch/dataset-server";
import type { EventingClickHouseClientResolver } from "@langwatch/eventing/server";
import { generate } from "@langwatch/ksuid";
import { getProjectModelProviders } from "@langwatch/model-provider-server";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { ProjectService } from "@langwatch/project-contract";
import { PostgresPromptAdapter } from "@langwatch/prompt-server";
import type { RedisConnection } from "@langwatch/redis-client";
import type { SimulationService } from "@langwatch/scenario-contract";
import {
  NodeScenarioChildProcessAdapter,
  OtelScenarioProcessorMetricsAdapter,
  PrismaScenarioAdapter,
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
import { AesGcmSecretEncryptionAdapter, PostgresSecretAdapter } from "@langwatch/secret-server";
import { RESERVED_PROJECT_SECRET_NAMES } from "@langwatch/secret-contract";
import { PostgresSuiteAdapter, SuiteExecutionPort } from "@langwatch/suite-server";
import {
  ClickHouseTraceAdapter,
  TraceFullIoPort,
  TracePayloadReaderPort,
  TraceQueryClassificationAdapter,
  TraceQueryFieldValuesPort,
  type TraceQueryFieldValuesResult,
} from "@langwatch/trace-server";
import {
  ContractWorkflowDslMigrationAdapter,
  HttpWorkflowNlpRuntimeAdapter,
  PostgresWorkflowAdapter,
  PrismaWorkflowProjectEnvironmentAdapter,
  UnconfiguredWorkflowNlpRuntimeAdapter,
  WorkflowLlmParametersPort,
  type WorkflowLlmParameterResolution,
} from "@langwatch/workflow-server";
import type { LLMConfig } from "@langwatch/workflow-contract";
import { nanoid } from "nanoid";

import type { WorkerConfig } from "../platform/config/worker.config";

/**
 * Reports the composition decision an absent executor would otherwise hide.
 *
 * A worker that composes no executor is not broken — the `execute` intent
 * refuses into the outbox and another pod takes the run. A fleet where NO pod
 * composes one looks identical from the outside and never runs anything, so
 * the reason belongs in the boot log rather than in a run that stays queued.
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
  modelProviders: ModelProviderService | undefined;
  projects: ProjectService | undefined;
  redis: RedisConnection | null | undefined;
  resolveClickHouseClient: EventingClickHouseClientResolver | undefined;
  defaultRetentionDays: number;
  absence?: WorkerScenarioExecutionAbsenceReportPort;
}>;

/** Everything an executor needs, once every optional above has answered. */
export type WorkerScenarioExecutionPrerequisites = Readonly<{
  config: WorkerConfig;
  connection: PrismaConnection;
  modelProviders: ModelProviderService;
  projects: ProjectService;
  redis: RedisConnection;
  resolveClickHouseClient: EventingClickHouseClientResolver;
  defaultRetentionDays: number;
  langwatchEndpoint: string;
  nlpServiceUrl: string;
  encryptionKey: string;
}>;

/**
 * Whether this process can run simulations, decided ONCE and before anything
 * is built.
 *
 * The decision is taken up front because the pool is handed to the simulation
 * pipeline as it is composed: a pool created here and left unconnected would
 * throw a different sentence into the same outbox, and the boot report would
 * then say a pool exists on a pod that cannot run a single run.
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
 *
 * `simulations` is the SAME service the pipeline's own commands write through,
 * handed in rather than built: a run this processor finishes as failed has to
 * append into the graph that is mounted, and a second simulation service would
 * write a terminal event nobody folds.
 */
export function createWorkerScenarioExecution(input: {
  prerequisites: WorkerScenarioExecutionPrerequisites;
  pool: ScenarioExecutionPoolService;
  simulations: SimulationService;
}): ScenarioProcessorService {
  const { prerequisites: deps, pool, simulations } = input;
  const prisma = deps.connection.client;
  const encryption = AesGcmSecretEncryptionAdapter.create({ key: deps.encryptionKey });
  const secretCipher = new WorkerScenarioSecretCipher(encryption);

  const scenarios = PrismaScenarioAdapter.create({
    prisma,
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

  const agents = PostgresAgentAdapter.create({
    database: prisma,
    processName: deps.config.serviceName,
  }).build();

  const suites = PostgresSuiteAdapter.create({
    database: prisma,
    agents,
    prompts,
    scenarios,
    resolveClickHouseClient: deps.resolveClickHouseClient as never,
    defaultRetentionDays: deps.defaultRetentionDays,
    execution: new WorkerSuiteStartRefusal(deps.config.serviceName),
    generateId: () => `suite_${nanoid()}`,
  }).build();

  const workflows = PostgresWorkflowAdapter.create({
    database: prisma,
    datasets: PostgresDatasetAdapter.create({ database: prisma }).build(),
    modelProviders: deps.modelProviders,
    nlpRuntime: deps.nlpServiceUrl
      ? HttpWorkflowNlpRuntimeAdapter.create({ serviceUrl: deps.nlpServiceUrl })
      : UnconfiguredWorkflowNlpRuntimeAdapter.create(),
    projectEnvironment: PrismaWorkflowProjectEnvironmentAdapter.create({
      database: prisma,
      encryption,
    }),
    llmParameters: WorkerWorkflowLlmParameters.create({ modelProviders: deps.modelProviders }),
    dslMigration: ContractWorkflowDslMigrationAdapter.create(),
  });

  const secrets = PostgresSecretAdapter.create({
    database: prisma,
    encryption,
    reservedNames: RESERVED_PROJECT_SECRET_NAMES,
  }).build();

  const execution = ScenarioExecutionService.create({
    pool,
    cancellations: RedisCancellationPublisherAdapter.create(deps.redis),
    prefetcher: ScenarioExecutionPrefetcherService.create({
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
      traces: composeTraceReads(deps),
    }),
    failures: ScenarioFailureHandlerService.create({ agents, simulations }),
  });

  return ScenarioProcessorService.create({
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
}

/**
 * The trace reads an HTTP target's ingest wait is measured on.
 *
 * The stored-span stack alone: the ingest-lag sample the wait is derived from
 * is a query over stored spans, and every other leg of the service — the
 * summary projection, the offloaded payload and the full-IO recomputation —
 * belongs to reads this preparer never makes.
 */
function composeTraceReads(deps: WorkerScenarioExecutionPrerequisites) {
  return ClickHouseTraceAdapter.create({
    resolveClient: deps.resolveClickHouseClient as never,
    modelProviders: deps.modelProviders,
    queryFieldValues: new UnlistedWorkerTraceQueryFieldValues(),
    queryClassification: TraceQueryClassificationAdapter.create(),
    payloads: new UnresolvedWorkerTracePayloadReader(),
    fullIo: new UnrecomputedWorkerTraceFullIo(),
  }).build();
}

/**
 * How a child is started, and where its sources are.
 *
 * `packageRoot` is this application's own directory, so the spawn resolves
 * `dist/server/scenario-child-process.cjs` and the `tsx` fallback against the
 * tree the entrypoint actually lives in. The branch ships no bundle yet, so the
 * fallback is what runs and the spawn adapter logs the remediation itself.
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
  now(): Date {
    return new Date();
  }
}

/**
 * A scenario's stored secret, under the deployment's own cipher.
 *
 * The SAME AES-256-GCM key the API tier writes with: a run's secret parameters
 * are encrypted on one tier and decrypted on this one, so a second key here
 * would fail every run that carries one.
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
 * Starting a suite run, on the process that DRAINS suite runs.
 *
 * Refused rather than composed: the start is a browser write dispatched on the
 * API's own producer, and this process reads a suite only to resolve the plan
 * overrides a simulation already in flight was configured with.
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

/** The facet read, which the ingest-lag read never asks for. */
class UnlistedWorkerTraceQueryFieldValues extends TraceQueryFieldValuesPort {
  list(): Promise<TraceQueryFieldValuesResult> {
    return Promise.resolve({ values: [] });
  }
}

/** An offloaded payload, on a process that resolves none for this read. */
class UnresolvedWorkerTracePayloadReader extends TracePayloadReaderPort {
  tryRead(): Promise<string | null> {
    return Promise.resolve(null);
  }
}

/** Full-IO recomputation, which the ingest-lag read never asks for. */
class UnrecomputedWorkerTraceFullIo extends TraceFullIoPort {
  recompute(): { input: null; output: null } {
    return { input: null, output: null };
  }
}

/**
 * Which of a workflow's models this project can actually run, and why not.
 *
 * Three outcomes rather than two, exactly as the API tier resolves them: a
 * provider the project never configured, one configured and switched off, and
 * one that is on and hands back prepared credentials. The provider rows
 * themselves never leave here.
 */
class WorkerWorkflowLlmParameters extends WorkflowLlmParametersPort {
  static create(input: { modelProviders: ModelProviderService }): WorkerWorkflowLlmParameters {
    return new WorkerWorkflowLlmParameters(input.modelProviders);
  }

  private constructor(private readonly modelProviders: ModelProviderService) {
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
