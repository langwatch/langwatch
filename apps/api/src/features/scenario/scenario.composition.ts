/**
 * The SCENARIO half of {@link ApiTrpcCollaborators}: the three surfaces an
 * agent's test cases are written, watched and driven through.
 *
 *   scenarios.*    the test cases a project defines and the runs they produced
 *   suites.*       the folders and suites those cases are grouped into
 *   setupSkills.*  the instructions an empty state hands a coding agent
 *
 * They are one composition because they are one graph: a scenario run IS an
 * agent conversation scored against a criterion, and it is read back through
 * the two connections this process already holds — its Prisma client and its
 * ClickHouse routing.
 *
 * The conversation panel and the operator back office used to be here too, on
 * the argument that a Langy turn is an agent conversation and that the queues a
 * run travels on are read through the back office. Neither is being one graph:
 * both compose themselves now, from the shared infrastructure and the peers
 * they name.
 *
 * ## This half OVERLAYS
 *
 * Like the analytics, execution and product-group halves, and unlike
 * {@link composeApiProductCollaborators}, it folds onto a base and passes an
 * absent base through untouched. It can genuinely be missing: a process with no
 * database resolves no scenario and no suite, and a list answering "no
 * scenarios" there would tell a customer their work was gone.
 *
 * ## What answers for real, and what refuses by name
 *
 * Every READ answers for real, off this process's own graph. A scenario and its
 * folders are Prisma rows; a simulation run and its messages are ClickHouse
 * rows on the same routed connection the charted reads use. The live simulation
 * subscription streams, because the emitter behind it is this process's own.
 *
 * Every WRITE that has to enqueue work ENQUEUES IT, on the pipelines the root
 * registers PRODUCER-only against this process's own Eventing: the eight
 * simulation commands and the suite run's start. The worker drains them. The
 * simulation definition declares a process manager, and the runtime declines to
 * RUN it by name rather than refusing the whole pipeline — producing a command
 * and running a process manager were never the same decision. With no queue at
 * all, every one of those writes refuses by name instead: never a silent no-op,
 * which would leave a customer watching a run that was never queued.
 *
 * Preparing a scenario run ANSWERS. Its target is resolved through ten other
 * verticals' services, and this process holds all ten: six it composes here —
 * the scenario, its suite, the prompt reader, the agent directory, the project
 * directory and the stored-secret cipher — and four it is handed, the workflow
 * service, the model gateway, the project secret store and the trace reads.
 * What it still refuses is SUBMITTING the run, and that one is honest: the
 * in-process execution pool is the worker's, and the outbox retries the
 * execute where a pool exists.
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
 *
 * Stated rather than imported, the same way the trace correction's prefix is:
 * they are PERSISTED formats — a process that spelled either differently would
 * write rows the other tier's queries do not find — and the application table
 * that used to hold them is one this migration deletes rather than moves.
 */
const SCENARIO_KSUID_RESOURCE = "scenario";
const SCENARIO_RUN_KSUID_RESOURCE = "scenariorun";

/** How far back the operator's event-log explorer searches by default. */
const OPS_EVENT_LOG_LOOKBACK_DAYS = 365;

/**
 * A capability this deployment did not compose, refused by name.
 *
 * One class for every entry in this half rather than one per entry, exactly as
 * the product-group half does it: the customer-facing distinction is WHICH
 * capability is missing, and that is the `capability` the message carries. The
 * `code` is what the presentation registry is keyed by, and there is one code.
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
 *
 * One entry rather than six loose ones, because they are one decision: a
 * process either can prepare a run against its own graph or cannot, and the
 * prefetcher needs the whole set before it can answer anything. `prompts`,
 * `agents`, `projects`, `scenarios` and `suites` are not here — this half
 * composes or already holds all five.
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
   * Where the child reports its own scenario events, where the NLP engine
   * answers, and the model a target that names none falls back to. All three
   * are the deployment's rather than the feature's, and all three are read by
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
   *
   * Taken rather than built, all of them: the workflow behind a workflow
   * target, the gateway its three model roles resolve through, the project
   * secrets its run parameters are decrypted from and the trace reads its
   * ingest wait is measured on are the same objects the rest of this process
   * serves — a second of any of them would prepare a run against a graph
   * nobody else can see.
   */
  scenarioExecution: ApiScenarioExecutionCollaborators;
  /** The user directory, as the browser-session boundary already composed it. */
  users: UserService;
  /** The project directory the tenancy graph composed. */
  projects: ProjectService;
  /**
   * The broadcast fabric presence already publishes on.
   *
   * All three of this half's subscriptions ride it: ONE emitter per tenant, so
   * a browser watching a simulation and a browser watching a conversation are
   * listening to the object the worker's own fan-out writes to.
   */
  broadcast: PresenceEmitterPort;
  /**
   * The deployment's cipher, as the stored-secret family composed it.
   *
   * The SAME one: a scenario's stored secret is written by one tier and read by
   * the other, so a second cipher here would be a second key.
   *
   * Absent where the deployment configured no stored-secret key. That used to
   * take this whole half — six namespaces — off the wire; it now costs exactly
   * the scenario reads and writes that touch a stored secret, which refuse by
   * name. Nothing else in this graph reads it.
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
   * The agent-side command senders this process registered producer-only, so a
   * scenario run and a suite run reach the worker that drains them. Registered
   * by the root rather than here: the Langy feature dispatches on the same
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
   * The canonical Scenario service and the tab registry, published for the
   * two packaged REST families that take them directly.
   *
   * Taken rather than rebuilt, for the same reason `simulations` is: a second
   * adapter over the same rows would let `/api/scenarios` and the simulations
   * page disagree about which scenarios a project holds, and a second tab
   * registry would give one project two presence keyspaces.
   */
  scenarioService: ScenarioService;
  scenarioTabs: ScenarioTabRegistry;
  /**
   * The canonical Simulation service, published so the run EXPORT can sweep
   * through it.
   *
   * Taken rather than rebuilt: the export never receives or reconstructs
   * Simulation's private ClickHouse repository, which is the whole reason it
   * is a service and not a query.
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
 *
 * `suites.*` and `setupSkills.*` take no ports at all — a suite is read through
 * `ctx.app.suites`, and the setup catalogue is a compiled artifact the package
 * holds — so the only thing a refusal changes is the two fire-and-forget
 * signals `scenarios.*` carries.
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
 *
 * All three namespaces still mount, so no other surface has to branch on
 * whether `ctx.app.scenarios` exists, and every call refuses by name — which is
 * what tells a customer their test cases are unreachable rather than gone.
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
 *
 * `createNull` rather than a throwing stand-in when there is no ClickHouse: the
 * package's own answer for a deployment with no run storage is an empty set,
 * and that is correct rather than degraded — a deployment that stores no runs
 * has no run to show.
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
 *
 * `createUnavailable` rather than `createNull` when there is no ClickHouse:
 * unlike `composeSimulations`, an empty answer here would be misleading — the
 * stat strip and the group rows are what tells an operator whether a
 * deployment with no ClickHouse endpoint is failing or merely quiet, so both
 * refuse by name instead of quietly reporting zero runs.
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
 *
 * One read asks for it — the suite preview's item rows — and the shared policy
 * it used to call lives in an application module this migration deletes rather
 * than moves. `run(null)` is the port's own "no hint" branch, so the read is
 * correct and merely unpruned: it scans the partitions a hinted read would have
 * skipped. Stated here rather than reimplemented, because a second copy of a
 * windowing heuristic is a second thing to keep true.
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
 *
 * The port is synchronous and the process's cipher is too — the same AES-256-GCM
 * `iv:ciphertext:authTag` format the platform app writes — so a row written by
 * one tier is read by the other unchanged.
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
 * The cipher a scenario's stored secret is written and read under, or a
 * refusal by name.
 *
 * Refusing here rather than at the composition, which is the whole narrowing:
 * an unset stored-secret key used to mean this half composed nothing and six
 * namespaces left the wire — the scenarios and their runs, the suites, both
 * Langy surfaces and the operator back office — because ONE store in the graph
 * happened to hold a cipher. Nothing but a scenario's own secret reads it, so
 * nothing but a scenario's own secret should lose anything.
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
 * Raised rather than answered with a blank, because a blank is worse: an agent
 * run handed an empty credential fails against the provider with a message
 * about the provider, and the person reading it has no way back to the missing
 * deployment key.
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
 *
 * Every answer is "nobody is here", which is the truth for a process that
 * cannot see the other pods' tabs. The consequence is bounded and stated:
 * a run started by the SDK opens its own browser tab rather than being handed
 * to one already open.
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
 *
 * The four legs, and why each is what it is:
 *
 *   prefetch / prepare  the real prefetcher. Everything it resolves a target
 *                       against — the workflow, the prompt, the agent, the
 *                       project, the scenario, its suite's overrides, the
 *                       model gateway, the project secrets and the trace
 *                       reads — is composed on THIS process, and `ScenarioApp`
 *                       reaches this leg alone. It answers a structured
 *                       failure rather than throwing when a target cannot be
 *                       resolved, which is what the run drawer renders.
 *   submit              refused by name, and honestly: the in-process worker
 *                       pool is the worker's, and `UnavailableScenarioExecutionPoolService`
 *                       is the package's own name for a pod that does not hold
 *                       one. The outbox retries the execute elsewhere.
 *   cancel              published on the process's Redis channel where it has
 *                       one, because the run being cancelled is executing on
 *                       another pod. With no Redis it refuses rather than
 *                       resolving, which would leave a person watching a run
 *                       they asked to stop.
 *   finishUnsuccessfulRun
 *                       the real failure handler, over the SAME simulation
 *                       service every other run read answers from.
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
 *
 * Logged rather than refused, and that is the same call the product-group half
 * makes for `prompts.afterPromptCreated`: refusing would cost a customer the
 * test case they just wrote to protect a marketing email nobody was waiting on.
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
