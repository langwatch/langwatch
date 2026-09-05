/**
 * The SCENARIO half of {@link ApiTrpcCollaborators}: the three surfaces an
 * agent's test cases are written, watched and driven through.
 */
import { MAX_CALL_TIMEOUT_MS } from "@langwatch/agent-contract";
import type { AgentService } from "@langwatch/agent-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import type { PresenceEmitterPort } from "@langwatch/presence-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import { PostgresPromptAdapter } from "@langwatch/prompt-server";
import type { RedisConnection } from "@langwatch/redis-client";
import {
  AgentTestService,
  PrismaScenarioAdapter,
  ResultAtomsClickHouseAdapter,
  RunConfigurationsClickHouseAdapter,
  ScenarioApp,
  ScenarioClockPort,
  ScenarioExecutionPrefetcherService,
  ScenarioExecutionService,
  ScenarioFailureHandlerService,
  ScenarioTestSuiteIdPort,
  ScenarioIdPort,
  ScenarioSecretCipherPort,
  ScenarioTabRegistryService,
  ScenarioTabStorePort,
  nlpFetchTimeoutsFromEnvironment,
  SerializedAgentRegistryAdapter,
  SimulationClickHouseAdapter,
  SimulationWindowedReadPort,
  RedisCancellationPublisherAdapter,
  RedisScenarioTabStoreAdapter,
  UnavailableCancellationPublisherAdapter,
  UnavailableScenarioExecutionPoolService,
  type ResultAtomsService,
  type RunConfigurationsService,
  type ScenarioExecutionPrefetchConfig,
  type ScenarioTrpcPorts,
  type SimulationReadClient,
  type SimulationWindowedReadInput,
} from "@langwatch/scenario-server";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import type { SecretService } from "@langwatch/secret-contract";
import type { TraceService } from "@langwatch/trace-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import type { SuiteService } from "@langwatch/suite-contract";
import type { SuiteClickHouseClient } from "@langwatch/suite-server";
import {
  PostgresSuiteAdapter,
  SuiteApp,
  SuiteExecutionService,
  SuiteRunIdPort,
  SuiteRunModelsService,
} from "@langwatch/suite-server";
import type {
  ScenarioService,
  ScenarioTabRegistry,
  SimulationService,
} from "@langwatch/scenario-contract";
import type { UserService } from "@langwatch/user-contract";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import type { ApiAgentPipelines } from "../../app/api-agent-pipelines.composition";
import type { ApiTrpcFeatureMount } from "../../api.application";
import { createSetupSkillsTrpcRouter } from "../langy/setup-skills-trpc.mount";
import { createSuiteTrpcRouter } from "../suite/suite-trpc.mount";
import { createScenarioTrpcRouter } from "./scenario-trpc.mount";
import { ApiAgentTestConnectedDispatchAdapter } from "../agent/agent-test-connected-dispatch.adapter";
import { ApiAgentTestOwnershipAdapter } from "../agent/agent-test-ownership.adapter";

/**
 * The ksuid resource prefixes a scenario and a run are persisted under.
 */
const SCENARIO_KSUID_RESOURCE = "scenario";
const SCENARIO_RUN_KSUID_RESOURCE = "scenariorun";

/**
 * A capability this deployment did not compose, refused by name.
 */
class ApiScenarioUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} is not available on this deployment`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiScenarioUnavailableError";
  }
}

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
  modelProviders: ModelProviderService;
  /** The project secret store a run's secret parameters are read from. */
  secrets: SecretService;
  /** The canonical trace reads an HTTP target's ingest wait is measured on. */
  traces: TraceService;
  /**
   * Where the child reports its own scenario events, where the NLP engine answers, and the model a target that
   * names none falls back to. All three are the deployment's rather than the feature's, and all three are read by
   * `api.config.ts`, which is this process's only environment reader.
   */
  config: ScenarioExecutionPrefetchConfig;
}>;

export type ScenarioFeatureCollaborators = Readonly<{
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  /** The permission service this process authorizes every other surface with. */
  authz: AuthzService;
  /** The agent directory a suite's cases are run against. */
  agents: AgentService;
  /**
   * The four other verticals a scenario RUN is prepared against, and the two
   * values its child is booted with.
   */
  scenarioExecution: ApiScenarioExecutionCollaborators;
  /** The user directory, as the browser-session boundary already composed it. */
  users: UserService;
  /** The project directory the tenancy graph composed. */
  projects: ProjectService;
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
  /**
   * The agent-side command senders this process registered producer-only, so a scenario run and a suite run reach
   * the worker that drains them. Registered by the root rather than here: the Langy feature dispatches on the same
   * runtime and is no longer composed beside this half.
   */
  pipelines: ApiAgentPipelines;
  /** Names this process in every refusal below. */
  processName: string;
  report?: ApiScenarioAbsenceReport;
}>;

/** The three routers, the two `ctx.app` slices, and the services the doors take. */
export type ComposedScenarioFeature = Readonly<{
  /** `scenarios.*`, `suites.*` and `setupSkills.*`, on the process's own root. */
  routers(mount: ApiTrpcFeatureMount): {
    scenarios: ReturnType<typeof createScenarioTrpcRouter>;
    setupSkills: ReturnType<typeof createSetupSkillsTrpcRouter>;
    suites: ReturnType<typeof createSuiteTrpcRouter>;
  };
  /** For `ctx.app.scenarios`. */
  scenarios: ScenarioApp;
  /**
   * The canonical Scenario service and the tab registry, published for the two
   * packaged REST families that take them directly.
   */
  scenarioService: ScenarioService;
  scenarioTabs: ScenarioTabRegistry;
  /**
   * The canonical Simulation service, published so the run EXPORT can sweep
   * through it.
   */
  simulations: SimulationService;
  /**
   * Runs "Test agent", for the `AgentTestPort` this root wires into the
   * Agent package's own application (`ApiAgentTestAdapter`).
   */
  agentTestService: AgentTestService;
  /** For `ctx.app.suites`. */
  suites: SuiteApp;
}>;

/** Composes the scenario feature over this process's own graph. */
export function composeScenarioFeature(
  options: ScenarioFeatureCollaborators,
): ComposedScenarioFeature {
  const logger = createLogger(`${options.processName}:scenario`);

  const pipelines = options.pipelines;
  if (!options.redis) options.report?.absent("live-buffer");

  const simulations = composeSimulations(options, pipelines);
  const scenarios = PrismaScenarioAdapter.create({
    prisma: options.prisma,
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

  const suites = PostgresSuiteAdapter.create({
    database: options.prisma,
    agents: options.agents,
    prompts,
    scenarios,
    resolveClickHouseClient: options.resolveClickHouseClient,
    defaultRetentionDays: options.defaultRetentionDays,
    execution: SuiteExecutionService.create({
      commands: pipelines.suiteRuns,
      ids: new KsuidSuiteRunId(),
      scenarios,
      resolveRunModels: SuiteRunModelsService.create({
        scenarios,
        modelProviders: options.scenarioExecution.modelProviders,
      }).resolve,
    }),
    generateId: () => `suite_${nanoid()}`,
  });
  // ONE suite service behind both applications and the prefetcher: a run's
  // suite overrides and the suite the page lists are the same rows.
  const suiteService = suites.build();

  const suiteApp = SuiteApp.create({
    suites: suiteService,
    scenarios,
    projects: options.projects,
    simulations,
  });

  const scenarioApp = ScenarioApp.create({
    scenarios,
    simulations,
    scenarioExecution: composeScenarioExecution(options, {
      scenarios,
      suites: suiteService,
      prompts,
      simulations,
    }),
    scenarioTabs,
    users: options.users,
    broadcast: options.broadcast,
    resultAtoms: composeResultAtoms(options),
    runConfigurations: composeRunConfigurations(options),
  });

  // "Test agent": the same target prefetch and adapter registry a real run
  // uses, over this process's own graph. Composed here rather than beside
  // `ScenarioApp` because it is `agents.testTurn`/`agents.testRun` that call
  // it — the Agent package's own tRPC surface, over a port it declares and
  // this root implements (`ApiAgentTestAdapter`).
  const agentTestService = AgentTestService.create({
    agents: options.agents,
    projects: options.projects,
    workflows: options.scenarioExecution.workflows,
    prompts,
    secrets: options.scenarioExecution.secrets,
    modelProviders: options.scenarioExecution.modelProviders,
    simulations,
    config: options.scenarioExecution.config,
    ownership: ApiAgentTestOwnershipAdapter.create(),
    connectedDispatch: ApiAgentTestConnectedDispatchAdapter.create(),
    agentAdapters: SerializedAgentRegistryAdapter.create({
      nlpTimeouts: nlpFetchTimeoutsFromEnvironment(process.env),
    }),
    maxCallTimeoutMs: MAX_CALL_TIMEOUT_MS,
  });

  return {
    scenarios: scenarioApp,
    scenarioService: scenarios,
    scenarioTabs,
    simulations,
    agentTestService,
    suites: suiteApp,
    routers: (mount) => scenarioRouters(mount, composeScenarioPorts(logger)),
  };
}

/**
 * The three namespaces, built the one way whether the feature composed or not.
 */
function scenarioRouters(mount: ApiTrpcFeatureMount, ports: ScenarioTrpcPorts) {
  return {
    scenarios: createScenarioTrpcRouter({ ...mount, ports }),
    // Takes no ports: the catalogue is a compiled artifact the Langy package
    // holds, so there is nothing for a deployment to answer.
    setupSkills: createSetupSkillsTrpcRouter(mount),
    // Takes no ports either — a suite, its folders and its runs are all read
    // through `ctx.app.suites`.
    suites: createSuiteTrpcRouter(mount),
  };
}

/**
 * The scenario surfaces on a process that composed no graph to run them over.
 */
export function refusingScenarioFeature(): ComposedScenarioFeature {
  const refuse = <T>(capability: string): T =>
    new Proxy(
      {},
      {
        get: () => (): never => {
          throw new ApiScenarioUnavailableError(capability);
        },
        has: () => true,
      },
    ) as T;

  return {
    routers: (mount) =>
      scenarioRouters(mount, {
        trackScenarioCreated: () => undefined,
        fireScenarioCreatedNurturing: () => undefined,
        captureException: () => undefined,
      }),
    scenarios: refuse<ScenarioApp>("The scenario surface"),
    scenarioService: refuse<ScenarioService>("The scenario store"),
    scenarioTabs: refuse<ScenarioTabRegistry>("The scenario tab registry"),
    simulations: refuse<SimulationService>("The simulation run store"),
    agentTestService: refuse<AgentTestService>("Running a test agent"),
    suites: refuse<SuiteApp>("The suite surface"),
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
    return SimulationClickHouseAdapter.createNull({ execution });
  }
  return SimulationClickHouseAdapter.create({
    resolveClient: options.resolveClickHouseClient,
    windowedRead: new UnwindowedApiSimulationRead(),
    execution,
  });
}

/**
 * The Results tab reads, and the run dialog's configuration history.
 */
function composeResultAtoms(options: ScenarioFeatureCollaborators): ResultAtomsService {
  if (!options.resolveClickHouseClient) {
    return ResultAtomsClickHouseAdapter.createUnavailable({ prisma: options.prisma });
  }
  return ResultAtomsClickHouseAdapter.create({
    resolveClient: options.resolveClickHouseClient,
    prisma: options.prisma,
  });
}

function composeRunConfigurations(options: ScenarioFeatureCollaborators): RunConfigurationsService {
  if (!options.resolveClickHouseClient) {
    return RunConfigurationsClickHouseAdapter.createUnavailable({ prisma: options.prisma });
  }
  return RunConfigurationsClickHouseAdapter.create({
    resolveClient: options.resolveClickHouseClient,
    prisma: options.prisma,
  });
}

/**
 * The partition-window policy, unapplied.
 */
class UnwindowedApiSimulationRead extends SimulationWindowedReadPort {
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
  now(): Date {
    return new Date();
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

/**
 * Raised rather than answered with a blank, because a blank is worse: an agent run handed an empty credential
 * fails against the provider with a message about the provider, and the person reading it has no way back to the
 * missing deployment key.
 */
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
    suites: SuiteService;
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
  });
}

/**
 * The two fire-and-forget signals a newly written test case fires.
 */
function composeScenarioPorts(logger: Logger): ScenarioTrpcPorts {
  return {
    trackScenarioCreated: ({ userId, projectId }) => {
      logger.info(
        { userId, projectId },
        "scenario created: this process composes no product-analytics sink, so the event was not recorded",
      );
    },
    fireScenarioCreatedNurturing: ({ userId, projectId, scenarioId }) => {
      logger.info(
        { userId, projectId, scenarioId },
        "scenario created: this process composes no nurturing sink, so no lifecycle mail was queued",
      );
    },
    captureException: (error) => {
      logger.error({ error }, "a scenario side effect failed");
    },
  };
}
