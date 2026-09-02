/**
 * The AGENT GROUP half of {@link ApiTrpcCollaborators}: the six surfaces an
 * agent is written, watched and driven through.
 *
 *   scenarios.*    the test cases a project defines and the runs they produced
 *   suites.*       the folders and suites those cases are grouped into
 *   langy.*        the conversation panel, its two live channels and the
 *                  turn-start commands behind them
 *   langyEgress.*  the allow-list bounding what the agent may reach
 *   ops.*          the operator back office the queues those runs travel on are
 *                  read through
 *   setupSkills.*  the instructions an empty state hands a coding agent
 *
 * They are one composition because they are one graph: a scenario run IS an
 * agent conversation scored against a criterion, a Langy turn IS an agent
 * conversation the customer is in, and both are read back through the same
 * three connections this process already holds — its Prisma client, its
 * ClickHouse routing and the queue's Redis.
 *
 * ## This half OVERLAYS
 *
 * Like the analytics, execution and product-group halves, and unlike
 * {@link composeApiProductCollaborators}, it folds onto a base and passes an
 * absent base through untouched. It can genuinely be missing: a process with no
 * database resolves no scenario, no suite and no conversation, and a panel
 * answering "no conversations" there would tell a customer their history was
 * gone.
 *
 * ## What answers for real, and what refuses by name
 *
 * Every READ answers for real, off this process's own graph. A scenario and its
 * folders are Prisma rows; a simulation run and its messages are ClickHouse
 * rows on the same routed connection the charted reads use; a Langy
 * conversation's spine and its messages are the Postgres projections the worker
 * writes; a live turn's tokens are the durable Redis buffer the worker appends
 * to. All three subscriptions stream, because the emitters behind them are this
 * process's own.
 *
 * Every WRITE that has to enqueue work ENQUEUES IT, on the three pipelines
 * `api-agent-pipelines.composition.ts` registers PRODUCER-only against this
 * process's own Eventing: the eight simulation commands, the suite run's start
 * and all sixteen Langy conversation commands. The worker drains them. Both the
 * simulation and the Langy definition declare a process manager, and the
 * runtime declines to RUN those by name rather than refusing the whole pipeline
 * — producing a command and running a process manager were never the same
 * decision. With no queue at all, every one of those writes refuses by name
 * instead: never a silent no-op, which would leave a customer watching a run
 * that was never queued.
 *
 * Two writes still refuse even with a queue, and both are DEPLOYMENT absences
 * rather than framework ones. Preparing a scenario run resolves its target
 * through ten other verticals' services, so `scenarios.run`'s prefetch refuses.
 * Starting a Langy turn dispatches to the agent manager over HTTP, so a process
 * with no Langy configuration answers the feature's own
 * `langy_agent_unavailable`. Renaming, forking, archiving and importing into a
 * conversation are pure commands and answer for real.
 *
 * The OPERATOR back office is the one surface that is mostly absence. Its
 * event-log explorer, its process-manager fleet explorer and its projection
 * replay runner have no packaged implementation at all — they are still the
 * platform application's classes — and its scheduled-job store is the same. All
 * four refuse by name. What does answer here is the half that is package-owned
 * and needs only Postgres: the admin allow-list, the impersonation ledger and
 * the back-office user, organization and project reads.
 */
import type { AgentService } from "@langwatch/agent-contract";
import type { AuthService } from "@langwatch/auth-contract";
import {
  declareAuthzMiddleware,
  type AuthzPermission,
  type AuthzService,
} from "@langwatch/authz-contract";
import type { FeatureFlagService, FeatureFlagTarget } from "@langwatch/feature-flag-contract";
import type { EventSourcing } from "@langwatch/eventing";
import { HandledError, NotFoundError } from "@langwatch/handled-error";
import {
  LangyApp,
  LangyTokenBuffer,
  LangyTurnAccessStore,
  LangyTurnHandoffStore,
  LangyUiActionCatalogPort,
  LangyUiActionService,
  PostgresLangyAdapter,
  type LangyEgressTrpcPorts,
  type LangyTrpcPorts,
  type LangyTurnTechnicalPorts,
  type LangyUiActionDefinition,
  type UiActionRedis,
} from "@langwatch/langy-server";
import { LangyNotEnabledError, renderLangyTurnContext } from "@langwatch/langy-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import {
  OpsApp,
  PostgresOpsAdapter,
  AdminAuditSink,
  NoopSchedulerWakeService,
  type OpsCapability,
  type OpsEventExplorer,
  type OpsProcessExplorer,
  type OpsReplayRunner,
  type OpsTrpcPorts,
  type SchedulerOpsRepository,
} from "@langwatch/ops-server";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PresenceEmitterPort } from "@langwatch/presence-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import { PostgresPromptAdapter } from "@langwatch/prompt-server";
import type { RedisConnection } from "@langwatch/redis-client";
import {
  PrismaScenarioAdapter,
  ScenarioApp,
  ScenarioClockPort,
  ScenarioFolderIdPort,
  ScenarioIdPort,
  ScenarioSecretCipherPort,
  ScenarioTabRegistryService,
  ScenarioTabStorePort,
  SimulationClickHouseAdapter,
  SimulationWindowedReadPort,
  RedisScenarioTabStoreAdapter,
  type ScenarioTrpcPorts,
  type SimulationReadClient,
  type SimulationWindowedReadInput,
} from "@langwatch/scenario-server";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import type { SuiteClickHouseClient } from "@langwatch/suite-server";
import {
  PostgresSuiteAdapter,
  SuiteApp,
  SuiteExecutionService,
  SuiteRunIdPort,
} from "@langwatch/suite-server";
import {
  ScenarioExecutionService,
  type ScenarioService,
  type ScenarioTabRegistry,
  type SimulationService,
} from "@langwatch/scenario-contract";
import type { UserService } from "@langwatch/user-contract";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import {
  composeApiAgentPipelines,
  type ApiAgentPipelines,
} from "./api-agent-pipelines.composition";
import type { AnyApiTrpcCollaborators } from "../app-trpc/app-trpc.collaborators";
import type { ApiTrpcFeatureApplication, ApiTrpcPortsContext } from "../app-trpc/app-trpc.context";
import type { AppAgentGroupTrpcPorts } from "../app-trpc/app-trpc.agent-group";
import type { ApiAuditPort } from "../api-request.policy";

/**
 * The rollout flag the authoritative Langy gate is read from.
 *
 * A literal rather than an import, and for the reason the analytics half states
 * about its metric registry: the two modules that declare this key —
 * `@langwatch/langy-web` and `@langwatch/trace-web` — are BROWSER packages, and
 * no server module may value-import one. The key is the deployment's flag name
 * on the wire, so restating it here is restating a wire constant, not forking a
 * decision.
 */
const LANGY_RELEASE_FLAG = "release_langy_enabled";

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
class ApiAgentGroupUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} is not available on this deployment`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiAgentGroupUnavailableError";
  }
}

/** Reports each absence in this half, with what it costs. */
export abstract class ApiAgentGroupAbsenceReport {
  abstract absent(
    capability: "run-commands" | "turn-commands" | "operator-runtime" | "live-buffer",
  ): void;
}

/** Writes each absence to the process log, with its consequence. */
export class LoggedApiAgentGroupAbsence extends ApiAgentGroupAbsenceReport {
  static create(logger: Pick<Logger, "warn">): LoggedApiAgentGroupAbsence {
    return new LoggedApiAgentGroupAbsence(logger);
  }

  private constructor(private readonly logger: Pick<Logger, "warn">) {
    super();
  }

  absent(capability: "run-commands" | "turn-commands" | "operator-runtime" | "live-buffer"): void {
    this.logger.warn({ capability }, CONSEQUENCE[capability]);
  }
}

const CONSEQUENCE = {
  "run-commands":
    "API process holds no command queue, so it registered no simulation or suite pipeline: starting a scenario run, cancelling one and starting a suite run all refuse by name. Reading runs, suites and their messages is unaffected, and the live simulation subscription still streams.",
  "turn-commands":
    "API process holds no command queue, so it registered no Langy conversation pipeline: starting a turn, continuing one, renaming, forking and deleting a conversation all refuse by name. Reading conversations and messages is unaffected, and both live channels still stream.",
  "operator-runtime":
    "API process composed no operator runtime: the event-log explorer, the process-manager fleet, the replay runner and the scheduled-job store all refuse by name. The admin allow-list, the impersonation ledger and the back-office reads answer for real.",
  "live-buffer":
    "API process holds no Redis: the Langy turn stream yields nothing and the browser falls back to the Postgres conversation read, tab presence is per-process, and the operator's queue views report nothing.",
} as const;

export type ApiAgentGroupCollaboratorsOptions = Readonly<{
  /** The one guarded connection every row read below runs on. */
  prisma: PrismaClient;
  /** The permission service this process authorizes every other surface with. */
  authz: AuthzService;
  /** The agent directory a suite's cases are run against. */
  agents: AgentService;
  /** The Auth service the back-office user reads resolve a person through. */
  auth: AuthService;
  /** The user directory, as the browser-session boundary already composed it. */
  users: UserService;
  /** The project directory the tenancy graph composed. */
  projects: ProjectService;
  /** The organization directory, for the operator's back-office search. */
  organizations: OrganizationService;
  /** This deployment's flag store, which the Langy rollout gate reads. */
  featureFlags: FeatureFlagService;
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
   */
  encryption: SecretEncryptionPort;
  /** The same routed ClickHouse the charted reads run on; absent is a real shape. */
  resolveClickHouseClient:
    | ((projectId: string) => Promise<SimulationReadClient & SuiteClickHouseClient>)
    | null;
  /** The queue's own Redis. The token buffer, tab presence and the ops queues share it. */
  redis: RedisConnection | null;
  /** The number the event store already stamps its own rows with. */
  defaultRetentionDays: number;
  /** The one project whose read access is granted to every authenticated user. */
  demoProjectId: string | undefined;
  /** The deployment's operator allow-list, as configuration states it. */
  adminEmails: readonly string[];
  /** The process's audit trail; an egress change and a back-office write both land on it. */
  audit: ApiAuditPort | undefined;
  /** The shared counter the two Langy budgets meter through. */
  rateLimit: (input: {
    key: string;
    windowSeconds: number;
    max: number;
  }) => Promise<{ allowed: boolean; resetAt: number }>;
  /**
   * The producer-only eventing runtime the three agent-side pipelines are
   * registered on, so a scenario run, a suite run and a Langy conversation
   * write reach the worker that drains them. Absent refuses all three by name.
   */
  eventing: EventSourcing | undefined;
  /** Names this process in every refusal below. */
  processName: string;
  report?: ApiAgentGroupAbsenceReport;
}>;

/** The application slices and the port group this half owns, composed together. */
export type ApiAgentGroupCollaborators = Readonly<{
  /** The `agentGroup` entry of {@link ApiTrpcCollaborators}. */
  ports: AppAgentGroupTrpcPorts;
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
  /** For `ctx.app.suites`. */
  suites: SuiteApp;
  /** For `ctx.app.langy` — the same application both Langy doors read. */
  langy: LangyApp;
  /** For `ctx.app.ops`. */
  ops: OpsApp;
}>;

/** Composes the agent-group half from this process's own graph. */
export function composeApiAgentGroupCollaborators(
  options: ApiAgentGroupCollaboratorsOptions,
): ApiAgentGroupCollaborators {
  const logger = createLogger(`${options.processName}:agent-group`);

  // The three agent-side pipelines, registered PRODUCER-only on this process's
  // own Eventing. Composed FIRST because every write below dispatches on them:
  // the eight simulation commands, the suite run's start, and all sixteen
  // conversation commands.
  const pipelines = composeApiAgentPipelines({
    eventing: options.eventing,
    processName: options.processName,
    report: {
      withoutQueue: () => {
        options.report?.absent("run-commands");
        options.report?.absent("turn-commands");
      },
    },
  });
  options.report?.absent("operator-runtime");
  if (!options.redis) options.report?.absent("live-buffer");

  const simulations = composeSimulations(options, pipelines);
  const scenarios = PrismaScenarioAdapter.create({
    prisma: options.prisma,
    simulations,
    ids: new KsuidScenarioId(),
    folderIds: new NanoidScenarioFolderId(),
    clock: new SystemScenarioClock(),
    secretCipher: new ApiScenarioSecretCipher(options.encryption),
  });

  const scenarioTabs = ScenarioTabRegistryService.create({
    store: options.redis
      ? RedisScenarioTabStoreAdapter.create(options.redis)
      : new UnavailableApiScenarioTabStore(),
    clock: new SystemScenarioClock(),
  });

  const scenarioApp = ScenarioApp.create({
    scenarios,
    simulations,
    // The run EXECUTOR, refused by name. It is the in-process worker pool a
    // web process never holds anyway — `roleRunsWorkers` is false here — and
    // its prefetcher reaches ten other verticals' services.
    scenarioExecution: new UnavailableApiScenarioExecution(),
    scenarioTabs,
    users: options.users,
    broadcast: options.broadcast,
  });

  const suites = PostgresSuiteAdapter.create({
    database: options.prisma,
    agents: options.agents,
    // A second prompt reader over the same table, and it cannot hold a second
    // answer: the product-group half wraps its own in a `PromptApp` that does
    // not expose the service underneath, and both are stateless reads of a
    // prompt row by id.
    prompts: PostgresPromptAdapter.create({ database: options.prisma }).build(),
    scenarios,
    resolveClickHouseClient: options.resolveClickHouseClient,
    defaultRetentionDays: options.defaultRetentionDays,
    execution: SuiteExecutionService.create({
      commands: pipelines.suiteRuns,
      ids: new KsuidSuiteRunId(),
      scenarios,
    }),
    generateId: () => `suite_${nanoid()}`,
  });

  const suiteApp = SuiteApp.create({
    suites: suites.build(),
    scenarios,
    projects: options.projects,
    simulations,
  });

  const langyApp = composeLangy(options, pipelines);
  const opsApp = composeOps(options, logger);

  return {
    scenarios: scenarioApp,
    scenarioService: scenarios,
    scenarioTabs,
    simulations,
    suites: suiteApp,
    langy: langyApp,
    ops: opsApp,
    ports: {
      scenarios: composeScenarioPorts(logger),
      langy: composeLangyPorts(options, langyApp),
      langyGates: composeLangyGates(options),
      langyEgress: composeLangyEgressPorts(options),
      ops: composeOpsPorts(),
      opsCheck: composeOpsCheck(opsApp),
    },
  };
}

/**
 * Folds this half into whatever the other halves supplied.
 *
 * Merged rather than replacing, and the application slice merged field by
 * field, for the reason {@link ApiTrpcCollaborators.application} states: a
 * request carries ONE application.
 *
 * `ops` is written here even though the identity half already writes a narrow
 * `isAdmin` reader into the same slot. That is deliberate and it is not a
 * conflict: the operator SURFACE reads the whole application, the narrow reader
 * (the SSO connection door, which gates on the staff list rather than on
 * `ops:*`) is satisfied by it unchanged, and one object answering both is the
 * only shape in which the staff list cannot differ between the two doors.
 */
export function withApiAgentGroupCollaborators(
  base: AnyApiTrpcCollaborators | undefined,
  group: ApiAgentGroupCollaborators | undefined,
): AnyApiTrpcCollaborators | undefined {
  if (!base || !group) return base;
  return {
    ...base,
    agentGroup: group.ports,
    application: {
      ...base.application,
      scenarios: group.scenarios,
      suites: group.suites,
      langy: group.langy,
      ops: group.ops,
    } as ApiTrpcFeatureApplication,
  } as unknown as AnyApiTrpcCollaborators;
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
function composeSimulations(
  options: ApiAgentGroupCollaboratorsOptions,
  pipelines: ApiAgentPipelines,
) {
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
class NanoidScenarioFolderId extends ScenarioFolderIdPort {
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
 * The run executor, refused by name.
 *
 * A web process never holds the in-process pool anyway; what it would need to
 * hold instead is the prefetcher, which reaches workflows, prompts, agents,
 * model providers, secrets and the trace tree. Refusing names that rather than
 * resolving a run against a graph this process does not have.
 */
class UnavailableApiScenarioExecution extends ScenarioExecutionService {
  submit(): Promise<void> {
    return this.refuse();
  }
  cancel(): Promise<void> {
    return this.refuse();
  }
  prefetch(): Promise<never> {
    return this.refuse();
  }
  prepare(): never {
    throw new ApiAgentGroupUnavailableError("Preparing a scenario run");
  }
  finishUnsuccessfulRun(): Promise<void> {
    return this.refuse();
  }

  private refuse(): Promise<never> {
    return Promise.reject(new ApiAgentGroupUnavailableError("Executing a scenario"));
  }
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

// ---------------------------------------------------------------------------
// Langy
// ---------------------------------------------------------------------------

/**
 * The Langy application, over the Postgres projections the worker writes and
 * the Redis buffer it appends to.
 *
 * `events` is `null` rather than this process's event store, deliberately: the
 * store here is {@link EventStoreProducerOnly}, which holds no readable log, so
 * a conversation's durable event page is answered from the projections instead.
 */
function composeLangy(
  options: ApiAgentGroupCollaboratorsOptions,
  pipelines: ApiAgentPipelines,
): LangyApp {
  const adapter = PostgresLangyAdapter.create({ database: options.prisma });
  const redis = options.redis;

  const turns: LangyTurnTechnicalPorts = {
    // Resolving the model a turn runs on refuses rather than inventing one: a
    // guessed model bills a customer's key against a provider they did not
    // choose. The worker composition makes the same call for its title
    // generator, and for the same reason.
    models: {
      resolve: () => Promise.reject(new ApiAgentGroupUnavailableError("Resolving the Langy model")),
    },
    // No agent manager on a web process: dispatching is the worker's.
    worker: null,
    tokenBuffer: redis ? LangyTokenBuffer.create({ redis }) : null,
    permits: {
      reserve: () =>
        Promise.reject(new ApiAgentGroupUnavailableError("Reserving a Langy pull-request permit")),
      release: () => Promise.resolve(),
      check: () =>
        Promise.reject(new ApiAgentGroupUnavailableError("Reading the Langy pull-request budget")),
    },
    // Zero rather than a number: with no permit store there is no budget to
    // spend, and a positive cap would advertise one.
    perDayPrCap: 0,
    sessionKeys: {
      mint: () => Promise.reject(new ApiAgentGroupUnavailableError("Minting a Langy session key")),
      revoke: () => Promise.resolve(),
    },
    // The one turn port that answers for real here: rendering the composer's
    // context chips is pure, and the contract package owns it.
    context: { render: renderLangyTurnContext },
    metrics: { count: () => undefined },
    accessStore: redis ? LangyTurnAccessStore.create({ redis }) : null,
    handoffStore: redis ? LangyTurnHandoffStore.create({ redis }) : null,
  };

  const service = adapter.build({
    turns,
    credentials: {
      sessionKeys: {
        mint: () =>
          Promise.reject(new ApiAgentGroupUnavailableError("Minting a Langy session key")),
        revokeManaged: () => Promise.resolve("refused" as const),
      },
      virtualKeys: {
        provision: () =>
          Promise.reject(new ApiAgentGroupUnavailableError("Provisioning a Langy virtual key")),
      },
      github: {
        enabled: false,
        mintTurnToken: () => Promise.resolve(null),
      },
      runtime: {
        workerCallbackUrl: undefined,
        workerGatewayBaseUrl: undefined,
        mirrorProjectId: undefined,
      },
    },
    commands: pipelines.langyConversations,
    events: null,
    ...(redis ? { feedbackPromptRedis: redis } : {}),
  });

  return LangyApp.create({
    langy: service,
    redis: redis as unknown as Parameters<typeof LangyApp.create>[0]["redis"],
    broadcast: options.broadcast,
  });
}

/**
 * The two Langy budgets, the analytics sink and the UI-action channel.
 *
 * The budgets meter through the SAME counter the public REST surface and the
 * identity half's throttles use, so a caller has one budget per rule rather
 * than one per surface. They fail OPEN when the counter has no Redis, which is
 * the behaviour the platform host pinned: a chat that stops working because the
 * cache is down is worse than an unmetered minute.
 */
function composeLangyPorts(
  options: ApiAgentGroupCollaboratorsOptions,
  langy: LangyApp,
): LangyTrpcPorts {
  const logger = createLogger(`${options.processName}:langy`);
  const uiActions = () =>
    new LangyUiActionService({
      redis: options.redis as unknown as UiActionRedis,
      conversations: {
        findByIdVisible: (args) => langy.tryFindVisible(args),
      },
      buffer: LangyTokenBuffer.create({ redis: options.redis }),
      actions: new UnavailableApiLangyUiActionCatalog(),
    });

  const budget = (input: { userId: string; projectId: string }, key: string, max: number) =>
    options
      .rateLimit({ key: `${key}:${input.projectId}:${input.userId}`, windowSeconds: 60, max })
      .then(({ allowed }) => ({ allowed }))
      .catch(() => ({ allowed: true }));

  return {
    // 30 messages a minute and 60 warms, the two budgets the platform host set.
    // Restated here because they are this process's policy rather than Langy's,
    // and the module that held them is one this migration deletes.
    checkMessageRateLimit: (input) => budget(input, "langy:rl:msg", 30),
    checkWarmRateLimit: (input) => budget(input, "langy:rl:warm", 60),
    recordProductEvent: ({ userId, projectId, event }) => {
      logger.info(
        { userId, projectId, event },
        "langy product event not recorded: this process composes no product-analytics sink",
      );
    },
    uiActions: {
      claim: (input) => uiActions().claim(input),
      complete: (input) => uiActions().complete(input),
    },
  };
}

/**
 * The page-action catalogue, absent.
 *
 * The only catalogue that exists is the experiments workbench's, and it is a
 * browser module: a Langy server package may not reach it and neither may this
 * composition root. Every kind therefore reads as unknown, which refuses a
 * DISPATCH by name. The two procedures this record mounts — `claimUiAction` and
 * `completeUiAction` — never consult it, so the page half of the channel works
 * whole.
 */
class UnavailableApiLangyUiActionCatalog extends LangyUiActionCatalogPort {
  tryFind(_kind: string): LangyUiActionDefinition | null {
    return null;
  }
}

/**
 * The two gates every customer-facing Langy procedure carries, built here
 * because neither is a permission.
 */
function composeLangyGates(options: ApiAgentGroupCollaboratorsOptions) {
  /**
   * Refuses the demo project outright.
   *
   * `project:view` is granted to every authenticated user on the demo project,
   * so a permission check alone would expose whatever Langy chat somebody left
   * there. The server never runs Langy on the demo project, so the refusal is
   * explicit and it runs BEFORE the rollout gate.
   */
  const refuseDemoProject = async ({
    input,
    next,
  }: {
    input: { projectId?: string };
    next: () => unknown;
  }) => {
    if (options.demoProjectId && input.projectId === options.demoProjectId) {
      throw new NotFoundError("not_found", "Langy", input.projectId);
    }
    return next();
  };

  /**
   * The authoritative internal-only rollout decision, LAST in the chain so
   * membership is always proven by RBAC before the flag is read.
   *
   * The organization is resolved from the project rather than read off the
   * input: every project-scoped procedure carries only a `projectId`, and
   * evaluating an ORG-targeted rule with no organization at all is what made an
   * opted-in account read as "not enabled".
   */
  const enforceLangyAccess = async ({
    ctx,
    input,
    next,
  }: {
    ctx: unknown;
    input: { projectId?: string; organizationId?: string };
    next: () => unknown;
  }) => {
    const userId = (ctx as ApiTrpcPortsContext).actor().id;
    const organizationId =
      input.organizationId ??
      (input.projectId ? await options.projects.getOrganizationId(input.projectId) : undefined);

    const target: FeatureFlagTarget = input.projectId
      ? {
          kind: "project",
          userId,
          projectId: input.projectId,
          ...(organizationId ? { organizationId } : {}),
        }
      : organizationId
        ? { kind: "organization", userId, organizationId }
        : { kind: "user", userId };

    if (!(await options.featureFlags.isEnabled(LANGY_RELEASE_FLAG, target))) {
      // A typed handled error, not a bare NOT_FOUND: the client tells a rollout
      // gate apart from a load failure by the code on the wire.
      throw new LangyNotEnabledError();
    }
    return next();
  };

  return { refuseDemoProject, enforceLangyAccess };
}

/** The audit trail an egress allow-list change is recorded on. */
function composeLangyEgressPorts(options: ApiAgentGroupCollaboratorsOptions): LangyEgressTrpcPorts {
  const audit = options.audit;
  const logger = createLogger(`${options.processName}:langy-egress`);
  return {
    recordAudit: async (entry) => {
      if (!audit) {
        logger.warn(
          { projectId: entry.projectId, action: entry.action },
          "langy egress change not audited: this process composed no audit sink",
        );
        return;
      }
      // Awaited rather than fired and forgotten: an allow-list change is a
      // network policy, and the record of who widened it is part of the write.
      try {
        await audit.record(entry as unknown as Parameters<ApiAuditPort["record"]>[0]);
      } catch (error) {
        logger.error({ error, action: entry.action }, "langy egress audit failed");
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The operator back office
// ---------------------------------------------------------------------------

/**
 * The operator application, over the Postgres half of the operations capability.
 *
 * `redis` is deliberately NOT passed. The adapter's own invariant is that a
 * Redis connection demands a queue payload decoder, and decoding a queued job's
 * payload needs the tiered blob store — Redis blobs plus the project's own
 * object storage — which the stored-object vertical has not moved. Passing
 * Redis without the decoder throws at build; passing a decoder that cannot read
 * offloaded payloads would render a queue view that silently omits the large
 * jobs. So the queue and blob views take the package's own no-Redis form and
 * the absence is reported.
 */
function composeOps(options: ApiAgentGroupCollaboratorsOptions, logger: Logger): OpsApp {
  const operations = PostgresOpsAdapter.create({
    adminEmails: options.adminEmails,
    database: options.prisma,
    audit: new ApiOpsAuditSink(options.audit, logger),
    users: options.users,
    auth: options.auth,
    scheduler: {
      repository: unavailableSchedulerOpsRepository(),
      // The scheduler's own polling backstop preserves correctness without a
      // wake, which is what makes the noop the package's answer rather than a
      // degradation this root invented.
      wake: NoopSchedulerWakeService.create(),
      projects: options.projects,
    },
  }).build();

  return OpsApp.create({
    ops: Object.assign(operations, {
      eventExplorer: unavailableOperatorRuntime<OpsEventExplorer>("the event-log explorer"),
      managerExplorer: unavailableOperatorRuntime<OpsProcessExplorer>("the process-manager fleet"),
      replay: unavailableOperatorRuntime<OpsReplayRunner>("the projection replay runner"),
      snapshots: null,
    }) as OpsCapability,
    featureFlags: options.featureFlags,
    projects: options.projects,
  });
}

/**
 * One operator explorer, refused by name on every method.
 *
 * A Proxy rather than twenty-seven written stand-ins: these three types are
 * structural views over the operations vocabulary with no packaged
 * implementation anywhere, so what this file has to say about them is one
 * sentence — "this process has none" — and writing it out per method would bury
 * that in boilerplate that a new method would silently escape.
 */
function unavailableOperatorRuntime<T>(capability: string): T {
  return new Proxy(
    {},
    {
      get: () => () => Promise.reject(new ApiAgentGroupUnavailableError(capability)),
      has: () => true,
    },
  ) as T;
}

/** The scheduled-job store, refused by name: no package ships one. */
function unavailableSchedulerOpsRepository(): SchedulerOpsRepository {
  const refuse = (): Promise<never> =>
    Promise.reject(new ApiAgentGroupUnavailableError("The scheduled-job store"));
  return {
    tryFindByIdForOps: refuse,
    setActiveForOps: refuse,
    releaseSlotForOps: refuse,
    requestImmediateRunForOps: refuse,
    listForOps: refuse,
    listPausedForOps: refuse,
  } as unknown as SchedulerOpsRepository;
}

/** Bridges the operations package's audit sink onto this process's trail. */
class ApiOpsAuditSink extends AdminAuditSink {
  constructor(
    private readonly audit: ApiAuditPort | undefined,
    private readonly logger: Logger,
  ) {
    super();
  }

  async record(entry: {
    userId: string;
    action: string;
    args?: unknown;
    req?: unknown;
  }): Promise<void> {
    if (!this.audit) {
      this.logger.warn(
        { action: entry.action },
        "operator action not audited: this process composed no audit sink",
      );
      return;
    }
    await this.audit.record(entry as unknown as Parameters<ApiAuditPort["record"]>[0]);
  }
}

/**
 * The four operator ports, each answering for the PROCESS rather than for the
 * operations service.
 *
 * Three of them describe a runtime this process does not run: it registers no
 * pipelines (its Eventing is producer-only), it holds no Grafana configuration,
 * and it runs no system migrations. Each says so by name or by an explicit
 * "none", rather than by an empty list that reads as "nothing is registered".
 */
function composeOpsPorts(): OpsTrpcPorts {
  return {
    // An explicitly empty registry, not a refusal: this process genuinely
    // registers no projections and no subscribers, so "none" is the true
    // answer rather than a missing one.
    listPipelineRegistrations: () => ({ projections: [], eventSubscribers: [] }),
    getEventLogSearchWindow: () => ({
      searchLookbackDays: OPS_EVENT_LOG_LOOKBACK_DAYS,
      // Null is "we cannot say", which is the honest answer for a process that
      // reads no table TTL configuration.
      hotTierDays: null,
      hotTierEnvVar: null,
    }),
    tryGetGrafanaLinkConfig: () => null,
    systemMigrations: unavailableOperatorRuntime<OpsTrpcPorts["systemMigrations"]>(
      "The system-migrations runner",
    ),
  };
}

/**
 * The platform-tier operator gate.
 *
 * Custom rather than a permission, and declared as such so the router sweep
 * counts it: it resolves the deployment's admin allow-list into an ops scope no
 * procedure input carries. Two details it must keep, because both are
 * load-bearing:
 *
 *  - the IMPERSONATOR's own grant carries through. An impersonation session
 *    rewrites the session user to the customer being debugged, so reading only
 *    that identity would hide the operator surface at exactly the moment an
 *    admin opened it to look at somebody's account.
 *  - `throwOnDeny: false` REPORTS "no access" instead of refusing, which is
 *    what lets the global menu poll the scope on every page load.
 */
function composeOpsCheck(ops: OpsApp) {
  return ({
    permission,
    throwOnDeny = true,
  }: {
    permission: AuthzPermission;
    throwOnDeny?: boolean;
  }) =>
    declareAuthzMiddleware(
      {
        kind: "custom",
        reason:
          "platform-tier operator check: resolves the admin allow-list into an ops scope no procedure input carries",
        permissions: [permission],
      },
      async ({ ctx, next }: { ctx: unknown; next: () => Promise<unknown> }) => {
        const context = ctx as {
          session?: {
            user?: { email?: string | null; impersonator?: { email?: string | null } };
          } | null;
          opsScope?: { kind: "platform" | "none" };
          permissionChecked?: boolean;
        };
        const user = context.session?.user;
        if (!user) throw new ApiAgentGroupUnauthenticatedError();

        const scope: { kind: "platform" | "none" } =
          ops.isAdmin({ email: user.email }) || ops.isAdmin({ email: user.impersonator?.email })
            ? { kind: "platform" }
            : { kind: "none" };

        if (scope.kind === "none" && throwOnDeny) {
          throw new ApiOperatorForbiddenError();
        }

        context.opsScope = scope;
        // The fail-closed backstop reads this: without it the chain would
        // refuse a procedure this check just passed.
        context.permissionChecked = true;
        return next();
      },
    );
}

/** The operator surface reached without a signed-in session. */
class ApiAgentGroupUnauthenticatedError extends HandledError {
  declare readonly code: "unauthorized";

  constructor() {
    super("unauthorized", "Sign in to reach the operator surface.", {
      httpStatus: 401,
      fault: "customer",
    });
    this.name = "ApiAgentGroupUnauthenticatedError";
  }
}

/** A signed-in caller who is not on the deployment's operator allow-list. */
class ApiOperatorForbiddenError extends HandledError {
  declare readonly code: "forbidden";

  constructor() {
    super("forbidden", "You do not have permission to access ops resources.", {
      httpStatus: 403,
      fault: "customer",
    });
    this.name = "ApiOperatorForbiddenError";
  }
}
