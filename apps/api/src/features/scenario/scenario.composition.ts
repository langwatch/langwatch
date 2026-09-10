/**
 * The SCENARIO half of {@link ApiTrpcCollaborators}: the three surfaces an
 * agent's test cases are written, watched and driven through.
 */
import type { WorkflowService } from "@langwatch/workflow-server";
import { MAX_CALL_TIMEOUT_MS } from "@langwatch/agent-contract";
import type { AgentApi } from "@langwatch/agent-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { PresenceEmitterPort } from "@langwatch/presence-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import { PostgresPromptAdapter, PromptApp } from "@langwatch/prompt-server";
import type { RedisConnection } from "@langwatch/redis-client";
import { createApp, LocalFeatureApis, type ResourceScope } from "@langwatch/runtime-composition";
import { ScenarioApi } from "@langwatch/scenario-contract";
import {
  AgentTestService,
  MemoryResultAtomsRepository,
  MemoryRunConfigurationsRepository,
  NullSimulationRepository,
  PostgresScenarioRepositories,
  ResultAtomsClickHouseRepository,
  ResultAtomsService,
  RunConfigurationsClickHouseRepository,
  RunConfigurationsService,
  scenarioServer,
  SimulationClickHouseRepository,
  SimulationService,
  type ScenarioAppInfrastructure,
  ScenarioClockPort,
  ScenarioExecutionPrefetcherService,
  ScenarioExecutionService,
  ScenarioFailureHandlerService,
  ScenarioTestSuiteIdPort,
  ScenarioIdPort,
  ScenarioSecretCipherPort,
  ScenarioTabRegistryService,
  ScenarioTabStorePort,
  NlpFetchAdapter,
  SerializedAgentRegistryAdapter,
  SimulationWindowedRepository,
  RedisCancellationPublisherAdapter,
  RedisScenarioTabStoreAdapter,
  UnavailableCancellationPublisherAdapter,
  UnavailableScenarioExecutionPoolService,
  type ScenarioExecutionPrefetchConfig,
  type SimulationReadClient,
  type SimulationWindowedReadInput,
} from "@langwatch/scenario-server";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import type { SecretApi } from "@langwatch/secret-contract";
import type { TraceApi } from "@langwatch/trace-contract";

import type { PromptService } from "@langwatch/prompt-contract";
import type { SuiteApi } from "@langwatch/suite-contract";
import type { ConnectedPresenceReader, SuiteClickHouseClient } from "@langwatch/suite-server";
import {
  SuiteExecutionService,
  SuiteRunIdPort,
  SuiteRunModelsService,
} from "@langwatch/suite-server";

import { installApiSuite } from "../suite/suite.composition.ts";
import { ScenarioService, scenarioTrpcTransport } from "@langwatch/scenario-server";
import { UserApi } from "@langwatch/user-contract";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import type { ApiAgentPipelines } from "../../app/api-agent-pipelines.composition.ts";
import { nowInstant, toDate } from "@langwatch/time";

/**
 * The ksuid resource prefixes a scenario and a run are persisted under.
 */
const SCENARIO_KSUID_RESOURCE = "scenario";
const SCENARIO_RUN_KSUID_RESOURCE = "scenariorun";

/** Reports each absence in this half, with what it costs. */
export abstract class ApiScenarioAbsenceReport {
  abstract absent(capability: "live-buffer" | "scenario-secrets"): void;
}

/** Writes each absence to the process log, with its consequence. */
export class LoggedApiScenarioAbsence extends ApiScenarioAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiScenarioAbsence {
    return new LoggedApiScenarioAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(capability: "live-buffer" | "scenario-secrets"): void {
    this.logger.warn({ capability }, CONSEQUENCE[capability]);
  }
}

const CONSEQUENCE = {
  "live-buffer":
    "API process holds no Redis: scenario tab presence is per-process rather than shared, so two browsers on one project do not see each other's open tabs.",
  "scenario-secrets":
    "API process composed no stored-secret cipher: reading or writing a scenario's own stored secret refuses by name. Every other scenario read and write, and the suites beside them, are unaffected.",
} as const;

/**
 * What preparing a scenario run reaches outside this half.
 */
export type ApiScenarioExecutionCollaborators = Readonly<{
  /** The workflow behind a workflow target, hydrated with its default model. */
  workflows: WorkflowService;
  /** The ONE model gateway the adapter, simulator and judge roles resolve on. */
  modelProviders: ModelProviderApi;
  /** The project secret store a run's secret parameters are read from. */
  secrets: SecretApi;
  /** The canonical trace reads an HTTP target's ingest wait is measured on. */
  traces: TraceApi;
  /** Deployment endpoints and fallback model, parsed once by API config. */
  config: ScenarioExecutionPrefetchConfig;
}>;

export type ScenarioFeatureCollaborators = Readonly<{
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  resources: ResourceScope;
  /** The permission service this process authorizes every other surface with. */
  authz: AuthzService;
  /** The agent directory a suite's cases are run against. */
  agents: AgentApi;
  /**
   * Which connected agents have a process attached. A target that names a
   * connected agent without an environment is settled by presence, so a
   * process that composed no connected-agent runtime supplies none and such a
   * target is refused rather than guessed at.
   */
  connectedPresence?: ConnectedPresenceReader;
  /**
   * The four other verticals a scenario RUN is prepared against, and the two
   * values its child is booted with.
   */
  scenarioExecution: ApiScenarioExecutionCollaborators;
  /** The user directory, as the browser-session boundary already composed it. */
  users: UserApi;
  /** The project directory the tenancy graph composed. */
  projects: ProjectApi;
  /**
   * The broadcast fabric presence already publishes on.
   */
  broadcast: PresenceEmitterPort;
  /**
   * The deployment's cipher, as the stored-secret family composed it.
   */
  encryption: SecretEncryptionPort | undefined;
  /** The same routed ClickHouse the charted reads run on; absent is a real shape. */
  resolveClickHouseClient:
    | ((projectId: string) => Promise<SimulationReadClient & SuiteClickHouseClient>)
    | null;
  /** The queue's own Redis, which tab presence rides. */
  redis: RedisConnection | null;
  /** The number the event store already stamps its own rows with. */
  defaultRetentionDays: number;
  /** Root-owned command senders shared by Scenario, Suite and Langy. */
  pipelines: ApiAgentPipelines;
  /** Names this process in every refusal below. */
  processName: string;
  report?: ApiScenarioAbsenceReport;
}>;

import type { ComposedScenarioFeature } from "./scenario.composition.types.ts";

/**
 * Composes the scenario feature over this process's own graph and boots it
 * through the module runtime: persistence is selected once, `ScenarioApp` is
 * built over it, and the declared `scenarios.*` namespace is served from the
 * contract. The rest of the feature's technical collaborators still arrive as
 * one `infrastructure` bag, because `ScenarioApp` has not yet absorbed the
 * construction of agent testing, the run executor, the ClickHouse-backed reads
 * and the Suite peer; that move is the module's next step.
 */
export async function installApiScenario(
  options: ScenarioFeatureCollaborators,
): Promise<ComposedScenarioFeature> {
  const logger = createLogger(`${options.processName}:scenario`);

  const clients = new LocalFeatureApis();
  clients.declare(ScenarioApi);
  const scenarioApi = clients.reference(ScenarioApi);
  options.resources.own("api scenario peer", () => clients.close());

  const pipelines = options.pipelines;
  if (!options.redis) options.report?.absent("live-buffer");

  const simulations = composeSimulations(options, pipelines);
  const scenarios = ScenarioService.create({
    repository: PostgresScenarioRepositories.create({ prisma: options.prisma }).scenarios,
    simulations,
    ids: new KsuidScenarioId(),
    testSuiteIds: new NanoidScenarioTestSuiteId(),
    clock: new SystemScenarioClock(),
    secretCipher: composeScenarioSecretCipher(options),
  });

  const scenarioTabs = ScenarioTabRegistryService.create({
    store: options.redis
      ? RedisScenarioTabStoreAdapter.create(options.redis)
      : new UnavailableApiScenarioTabStore(),
    clock: new SystemScenarioClock(),
  });

  // A second prompt reader over the same table, and it cannot hold a second
  // answer: the product-group half wraps its own in a `PromptApp` that does
  // not expose the service underneath, and both are stateless reads of a
  // prompt row by id. ONE here, because the suite listing and the prefetched
  // prompt target read the same rows.
  const prompts = PostgresPromptAdapter.create({ database: options.prisma }).build();

  const promptApp = PromptApp.createReader({ prompts, projects: options.projects });
  const suite = await installApiSuite({
    prisma: options.prisma,
    peers: {
      scenarios: scenarioApi,
      agents: options.agents,
      prompts: promptApp,
      projects: options.projects,
    },
    infrastructure: {
      ...(options.connectedPresence ? { connectedPresence: options.connectedPresence } : {}),
      resolveClickHouseClient: options.resolveClickHouseClient,
      defaultRetentionDays: options.defaultRetentionDays,
      execution: SuiteExecutionService.create({
        commands: pipelines.suiteRuns,
        ids: new KsuidSuiteRunId(),
        scenarios: scenarioApi,
        resolveRunModels: SuiteRunModelsService.create({
          scenarios: scenarioApi,
          modelProviders: options.scenarioExecution.modelProviders,
        }).resolve,
      }),
      generateId: () => `suite_${nanoid()}`,
    },
  });
  const suiteApp = suite.app;

  /**
   * The technical collaborators the module still takes as one bag: the private
   * services this feature builds over several other verticals, and the four
   * small ports the scenario store itself is built over. The repository seam
   * is the runtime's.
   */
  const infrastructure: ScenarioAppInfrastructure = {
    agentTesting: AgentTestService.create({
      agents: options.agents,
      projects: options.projects,
      workflows: options.scenarioExecution.workflows,
      prompts,
      secrets: options.scenarioExecution.secrets,
      modelProviders: options.scenarioExecution.modelProviders,
      simulations,
      config: options.scenarioExecution.config,
      agentAdapters: SerializedAgentRegistryAdapter.create({
        nlpTimeouts: NlpFetchAdapter.timeoutsFromEnvironment(process.env),
      }),
      maxCallTimeoutMs: MAX_CALL_TIMEOUT_MS,
    }),
    simulations,
    scenarioExecution: composeScenarioExecution(options, {
      scenarios,
      suites: suiteApp,
      prompts,
      simulations,
    }),
    scenarioTabs,
    broadcast: options.broadcast,
    resultAtoms: composeResultAtoms(options),
    runConfigurations: composeRunConfigurations(options),
    ids: new KsuidScenarioId(),
    testSuiteIds: new NanoidScenarioTestSuiteId(),
    clock: new SystemScenarioClock(),
    secretCipher: composeScenarioSecretCipher(options),
  };

  const runtime = await createApp({ name: options.processName })
    .withPersistence("postgres", { prisma: options.prisma })
    .withInfrastructure({})
    .withProvided(UserApi, options.users)
    .withModule(scenarioServer, { infrastructure })
    .boot({ role: "api" });

  const scenarioApp = runtime.module(scenarioServer).provided;

  clients.bind(ScenarioApi, scenarioApp);
  clients.ready();

  return {
    scenarios: scenarioApp,
    scenarioService: scenarios,
    scenarioTabs,
    simulations,
    suites: suiteApp,
    routers: (mount) => ({
      scenarios: mount.runtime.mount(scenarioTrpcTransport, (ctx) => ctx.app.scenarios),
    }),
  };
}

// ---------------------------------------------------------------------------
// Scenario and Suite
// ---------------------------------------------------------------------------

/**
 * The simulation reader, over the same routed ClickHouse the charted reads use.
 */
function composeSimulations(options: ScenarioFeatureCollaborators, pipelines: ApiAgentPipelines) {
  const execution = pipelines.simulations;
  if (!options.resolveClickHouseClient) {
    return SimulationService.create(new NullSimulationRepository(), execution);
  }
  return SimulationService.create(
    SimulationClickHouseRepository.create(
      options.resolveClickHouseClient,
      new UnwindowedApiSimulationRead(),
    ),
    execution,
  );
}

/**
 * The Results tab reads, and the run dialog's configuration history.
 */
function composeResultAtoms(options: ScenarioFeatureCollaborators): ResultAtomsService {
  const scenarios = PostgresScenarioRepositories.create({ prisma: options.prisma }).scenarios;
  if (!options.resolveClickHouseClient) {
    return ResultAtomsService.create(new MemoryResultAtomsRepository(), scenarios);
  }
  return ResultAtomsService.create(
    ResultAtomsClickHouseRepository.create(options.resolveClickHouseClient),
    scenarios,
  );
}

function composeRunConfigurations(options: ScenarioFeatureCollaborators): RunConfigurationsService {
  const scenarios = PostgresScenarioRepositories.create({ prisma: options.prisma }).scenarios;
  if (!options.resolveClickHouseClient) {
    return RunConfigurationsService.create(new MemoryRunConfigurationsRepository(), scenarios);
  }
  return RunConfigurationsService.create(
    RunConfigurationsClickHouseRepository.create(options.resolveClickHouseClient),
    scenarios,
  );
}

/**
 * The partition-window policy, unapplied.
 */
class UnwindowedApiSimulationRead extends SimulationWindowedRepository {
  query<Result>(input: SimulationWindowedReadInput<Result>): Promise<Result> {
    return input.run(null);
  }
}

/** The run id a suite run is recorded under, in the persisted ksuid format. */
class KsuidSuiteRunId extends SuiteRunIdPort {
  next(): string {
    return generate(SCENARIO_RUN_KSUID_RESOURCE).toString();
  }
}

/** The scenario id, in the persisted ksuid format the other tier reads. */
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
 * A scenario's stored secret, under the deployment's own cipher.
 */
class ApiScenarioSecretCipher extends ScenarioSecretCipherPort {
  constructor(private readonly encryption: SecretEncryptionPort) {
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
 * The cipher a scenario's stored secret is written and read under, or a refusal
 * by name.
 */
function composeScenarioSecretCipher(
  options: ScenarioFeatureCollaborators,
): ScenarioSecretCipherPort {
  if (options.encryption) return new ApiScenarioSecretCipher(options.encryption);
  options.report?.absent("scenario-secrets");
  return new UnavailableApiScenarioSecretCipher();
}

/** A scenario secret this deployment can neither write nor read. */
class UnavailableApiScenarioSecretCipher extends ScenarioSecretCipherPort {
  encrypt(): string {
    throw new ScenarioSecretsUnavailableError();
  }

  decrypt(): string {
    throw new ScenarioSecretsUnavailableError();
  }
}

/** Refuses decryption without the deployment key before a provider receives invalid credentials. */
class ScenarioSecretsUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super(
      "service_unavailable",
      "This deployment cannot store or read scenario secrets, because it has no encryption key configured.",
      { httpStatus: 503, fault: "platform" },
    );
    this.name = "ScenarioSecretsUnavailableError";
  }
}

/**
 * Tab presence, without Redis.
 */
class UnavailableApiScenarioTabStore extends ScenarioTabStorePort {
  refresh(): Promise<void> {
    return Promise.resolve();
  }
  retire(): Promise<void> {
    return Promise.resolve();
  }
  countAfter(): Promise<number> {
    return Promise.resolve(0);
  }
  setPending(): Promise<void> {
    return Promise.resolve();
  }
  tryTakePending(): Promise<string | null> {
    return Promise.resolve(null);
  }
}

/**
 * The run EXECUTOR, composed over this process's own graph.
 */
function composeScenarioExecution(
  options: ScenarioFeatureCollaborators,
  composed: {
    scenarios: ScenarioService;
    suites: SuiteApi;
    prompts: PromptService;
    simulations: SimulationService;
  },
): ScenarioExecutionService {
  const { workflows, modelProviders, secrets, traces, config } = options.scenarioExecution;
  return ScenarioExecutionService.create({
    pool: UnavailableScenarioExecutionPoolService.create(),
    cancellations: options.redis
      ? RedisCancellationPublisherAdapter.create(options.redis)
      : UnavailableCancellationPublisherAdapter.create(),
    prefetcher: ScenarioExecutionPrefetcherService.create({
      // The SAME cipher the scenario service writes a stored secret with: a
      // run's secret parameters are decrypted here and encrypted there, and a
      // second cipher would be a second key.
      secretCipher: composeScenarioSecretCipher(options),
      config,
      scenarios: composed.scenarios,
      suites: composed.suites,
      prompts: composed.prompts,
      agents: options.agents,
      workflows,
      projects: options.projects,
      modelProviders,
      secrets,
      traces,
    }),
    failures: ScenarioFailureHandlerService.create({
      agents: options.agents,
      simulations: composed.simulations,
    }),
    simulations: composed.simulations,
  });
}
