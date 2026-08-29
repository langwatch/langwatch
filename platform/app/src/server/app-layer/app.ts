import { AgentApp } from "@langwatch/agent-server";
import { AnalyticsApp } from "@langwatch/analytics-server";
import { AnnotationApp } from "@langwatch/annotation-server";
import { ApiKeyApp } from "@langwatch/api-key-server";
import { AuthzApp } from "@langwatch/authz-server";
import { AutomationApp } from "@langwatch/automation-server";
import { CodingAgentApp } from "@langwatch/coding-agent-server";
import { DashboardApp } from "@langwatch/dashboard-server";
import { DatasetApp } from "@langwatch/dataset-server";
import { GovernanceApp } from "@langwatch/enterprise-governance-server";
import { ScimApp } from "@langwatch/enterprise-scim-server";
import { WebhookApp } from "@langwatch/enterprise-webhook-server";
import { EvaluatorApp } from "@langwatch/evaluator-server";
import type { EventSourcing } from "@langwatch/eventing";
import { ExperimentApp } from "@langwatch/experiment-server";
import { LangyApp } from "@langwatch/langy-server";
import { ModelProviderApp } from "@langwatch/model-provider-server";
import { MonitorApp } from "@langwatch/monitor-server";
import { createLogger } from "@langwatch/observability";
import { OpsApp } from "@langwatch/ops-server";
import { OrganizationApp } from "@langwatch/organization-server";
import { ProjectApp } from "@langwatch/project-server";
import { PromptApp } from "@langwatch/prompt-server";
import { RoleApp } from "@langwatch/role-server";
import { ScenarioApp } from "@langwatch/scenario-server";
import { SecretApp } from "@langwatch/secret-server";
import { StoredObjectApp } from "@langwatch/stored-object-server";
import { SuiteApp } from "@langwatch/suite-server";
import { TraceApp } from "@langwatch/trace-server";
import { UserApp } from "@langwatch/user-server";
import { WorkflowApp } from "@langwatch/workflow-server";
import { assertWebhookEndpointsEntitled } from "~/runtime/app/features/webhooks";
import type { AppCommands } from "~/server/event-sourcing/registration/pipelineRegistry";
import { withIdempotency } from "~/server/api/idempotency";
import { prisma } from "~/server/db";
import { webhookDestinationFor } from "~/server/webhooks/destinations";
import { SHUTDOWN_BUDGET } from "../shutdown/budget";
import type { AppConfig } from "./config";
import type { AppDependencies, DataRetentionDependencies } from "./dependencies";

const logger = createLogger("langwatch:app");

type SettleOutcome =
  | { status: "done" }
  | { status: "failed"; error: unknown }
  | { status: "timeout" };

export const APP_SHUTDOWN_PHASES = [
  "subscriber",
  "redis",
  "clickhouse",
  "database",
] as const;

export type AppShutdownPhase = (typeof APP_SHUTDOWN_PHASES)[number];

type AppShutdownResource = {
  name: string;
  close: () => Promise<void>;
};

/**
 * Owns resources which outlive a request and the order in which their
 * connections can safely disappear. A subscriber may use Redis while it
 * settles; query services may use ClickHouse; only then can their roots go.
 */
export class AppShutdownResources {
  private readonly resources = new Map<AppShutdownPhase, AppShutdownResource[]>();

  register(phase: AppShutdownPhase, name: string, close: () => Promise<void>): void {
    const phaseResources = this.resources.get(phase) ?? [];
    phaseResources.push({ name, close });
    this.resources.set(phase, phaseResources);
  }

  async close(): Promise<void> {
    for (const phase of APP_SHUTDOWN_PHASES) {
      await this.closePhase(phase);
    }
  }

  private async closePhase(phase: AppShutdownPhase): Promise<void> {
    for (const resource of this.resources.get(phase) ?? []) {
      try {
        await resource.close();
      } catch (error) {
        logger.error(
          { phase, name: resource.name, error },
          "Failed to close application resource",
        );
      }
    }
  }
}

/**
 * Runs `run` under a deadline, reporting WHICH way it ended.
 *
 * The distinction is the whole point: a task that rejected has finished and
 * its resources are free, while a task that timed out is still running. Both
 * arriving as a thrown error is what made the caller treat them alike.
 */
async function settleWithTimeout({
  run,
  timeoutMs,
}: {
  run: () => Promise<void>;
  timeoutMs: number;
}): Promise<SettleOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<SettleOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
  });
  try {
    return await Promise.race([
      run().then(
        (): SettleOutcome => ({ status: "done" }),
        (error): SettleOutcome => ({ status: "failed", error }),
      ),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class App {
  readonly config: AppConfig;
  readonly nlpLambda: AppDependencies["nlpLambda"];
  readonly agents: AgentApp;
  readonly dataset: DatasetApp;
  readonly annotations: AnnotationApp;
  readonly apiKeys: ApiKeyApp;
  readonly managedProviders: AppDependencies["managedProviders"];
  readonly scim: AppDependencies["scim"];
  /** The SCIM feature's application; `scim` above is the raw capability. */
  readonly scimApp: ScimApp;
  readonly modelProviders: ModelProviderApp;
  readonly prompts: PromptApp;
  readonly evaluators: AppDependencies["evaluators"];
  /** The Evaluator feature's application; `evaluators` above is the raw service. */
  readonly evaluatorApp: EvaluatorApp;
  readonly workflows: WorkflowApp;
  readonly monitors: MonitorApp;

  readonly broadcast: AppDependencies["broadcast"];
  readonly presence: AppDependencies["presence"];
  readonly secrets: SecretApp;
  readonly traces: TraceApp;
  /**
   * The span, log and metric ingestion services, raw.
   *
   * NOT on `TraceApp`, and deliberately: that application answers reads a
   * person asked for, and ingestion answers a collector. They share a store
   * and nothing else — no permission, no actor, no protections. Folding them
   * in would give every trace door a method that writes the firehose.
   *
   * Named apart rather than reached through `traces` because this is the
   * highest-traffic path in the product and it should be obvious at the call
   * site which of the two a caller is on.
   */
  readonly traceIngestion: Readonly<{
    collection: AppDependencies["traces"]["collection"];
    logCollection: AppDependencies["traces"]["logCollection"];
    metricCollection: AppDependencies["traces"]["metricCollection"];
  }>;
  readonly evaluations: AppDependencies["evaluations"] & AppCommands["evaluations"];
  /** The ADR-034 analytics read API, and the restricted SQL surface beside it. */
  readonly analytics: AnalyticsApp;
  /** The process-owned restricted analytics SQL service. */
  readonly langWatchQL: AppDependencies["langWatchQL"];
  /** The process-owned dashboard, graph, and saved-chart lifecycle application. */
  readonly dashboard: DashboardApp;
  readonly simulations: AppDependencies["simulations"];
  readonly simulationExports: AppDependencies["simulationExports"];
  readonly topics: AppDependencies["topics"];
  readonly topicClustering: AppCommands["topicClustering"];
  readonly codingAgents: AppDependencies["codingAgents"] & AppCommands["codingAgents"];
  /** The Coding Agent feature's application; `codingAgents` above is the raw capability. */
  readonly codingAgentApp: CodingAgentApp;
  readonly gateway: AppDependencies["gateway"];
  /** The Webhook feature's application, over the process's endpoint store. */
  readonly webhooks: WebhookApp;
  readonly filters: AppDependencies["filters"];
  readonly clickhouse: AppDependencies["clickhouse"];
  /**
   * The process's one Redis connection, or `null` when none is configured.
   * See {@link AppDependencies.redis} — inject where you can, read it here
   * inside the handler where you cannot.
   */
  readonly redis: AppDependencies["redis"];
  readonly billing: AppDependencies["billing"];
  readonly governance: AppDependencies["governance"];
  /** The Governance feature's application; `governance` above is the raw capability. */
  readonly governanceApp: GovernanceApp;
  readonly billableEvents: AppDependencies["billableEvents"];
  readonly billingQueries: AppDependencies["billingQueries"];
  readonly commands: AppCommands;
  readonly storedObjects: AppDependencies["storedObjects"];
  /** The Stored Object feature's application; `storedObjects` above is the raw service. */
  readonly storedObjectApp: StoredObjectApp;
  readonly userAvatarObjects: AppDependencies["userAvatarObjects"];
  readonly storedObjectOwners: AppDependencies["storedObjectOwners"];
  readonly opsExplain: AppDependencies["opsExplain"];
  readonly github: AppDependencies["github"];
  readonly langy: LangyApp;
  readonly featureFlags: AppDependencies["featureFlags"];
  readonly experiments: ExperimentApp;
  readonly scenarios: ScenarioApp;
  readonly scenarioTabs: AppDependencies["scenarioTabs"];
  readonly scenarioExecution: AppDependencies["scenarioExecution"];
  readonly scenarioExecutionPool: AppDependencies["scenarioExecutionPool"];
  readonly suites: SuiteApp;
  readonly automation: AutomationApp;
  readonly organizations: OrganizationApp;
  /**
   * The organization service in full, raw.
   *
   * `OrganizationApp` narrows it on purpose — its own comment calls
   * `OrganizationService` "the widest surface in the platform", and an
   * organization screen has no business reaching the parts that answer
   * ingestion or billing claims. That narrowing is right, and it means the
   * CLI's personal-workspace lifecycle, which genuinely needs the whole
   * thing, cannot go through the application. It gets it here instead of the
   * application quietly widening back out.
   */
  readonly organizationService: AppDependencies["organizations"];
  readonly projects: ProjectApp;
  readonly users: UserApp;
  readonly roles: RoleApp;
  /**
   * The authorization engine itself, not an application over it.
   *
   * Ten framework sites ask it questions — the org-auth middleware, the
   * role-binding resolver, the tRPC scope-lineage guard, `rbac.ts`. `AuthzApp`
   * answers exactly one procedure (`effectivePermissionsFor`), so retyping
   * this to hold it would take the engine away from the plumbing in order to
   * serve one read. The application sits beside it as `authzApp`, which is
   * also the key its own door asks for.
   */
  readonly permissions: AppDependencies["permissions"];
  readonly authzApp: AuthzApp;
  readonly authzGrants: AppDependencies["authzGrants"];
  readonly tokenizer: AppDependencies["tokenizer"];
  readonly usage: AppDependencies["usage"];
  readonly planProvider: AppDependencies["planProvider"];
  readonly subscription?: AppDependencies["subscription"];
  readonly billingCustomer?: AppDependencies["billingCustomer"];
  readonly webhookService?: AppDependencies["webhookService"];
  readonly stripeClient?: AppDependencies["stripeClient"];
  readonly notifications: AppDependencies["notifications"];
  readonly mailer: AppDependencies["mailer"];
  readonly auth: AppDependencies["auth"];
  readonly betterAuth: AppDependencies["betterAuth"];
  readonly nurturing?: AppDependencies["nurturing"];
  readonly usageLimits: AppDependencies["usageLimits"];
  readonly ops: OpsApp;
  readonly dataRetention: DataRetentionDependencies;
  readonly share: AppDependencies["share"];

  /** Keeps EventSourcing infrastructure safe from the greedy garbage men */
  private readonly _eventSourcing?: EventSourcing;

  private readonly _authzMigration?: AppDependencies["_authzMigration"];

  get eventSourcing(): EventSourcing | undefined {
    return this._eventSourcing;
  }

  get authzMigration(): AppDependencies["_authzMigration"] {
    return this._authzMigration;
  }
  private readonly _shutdownResources: AppShutdownResources;
  private closePromise: Promise<void> | undefined;

  constructor(deps: AppDependencies) {
    this.config = deps.config;
    this.nlpLambda = deps.nlpLambda;
    this.agents = AgentApp.create({ agents: deps.agents });
    this.dataset = DatasetApp.create({
      dataset: deps.dataset,
      experiments: deps.experiments,
    });
    this.annotations = AnnotationApp.create({
      annotations: deps.annotations,
      users: deps.users,
    });
    this.apiKeys = ApiKeyApp.create({ apiKeys: deps.apiKeys });
    this.managedProviders = deps.managedProviders;
    this.scim = deps.scim;
    this.scimApp = ScimApp.create({
      scim: deps.scim,
      planProvider: deps.planProvider,
    });
    this.modelProviders = ModelProviderApp.create({
      modelProviders: deps.modelProviders,
      spans: deps.traces.spans,
    });
    this.prompts = PromptApp.create({
      prompts: deps.prompts,
      projects: deps.projects,
    });
    this.evaluators = deps.evaluators;
    this.evaluatorApp = EvaluatorApp.create({
      evaluators: deps.evaluators,
      modelProviders: deps.modelProviders,
    });
    this.workflows = WorkflowApp.create({
      workflows: deps.workflows,
      evaluators: deps.evaluators,
    });
    this.monitors = MonitorApp.create({
      monitors: deps.monitors,
      evaluations: deps.evaluations,
      evaluators: deps.evaluators,
    });
    this.featureFlags = deps.featureFlags;
    this.experiments = ExperimentApp.create({
      experiments: deps.experiments,
      workflows: deps.workflows,
      dataset: deps.dataset,
      monitors: deps.monitors,
      broadcast: deps.broadcast,
    });
    this.scenarios = ScenarioApp.create({
      scenarios: deps.scenarios,
      simulations: deps.simulations,
      scenarioExecution: deps.scenarioExecution,
      scenarioTabs: deps.scenarioTabs,
      users: deps.users,
      broadcast: deps.broadcast,
    });
    this.scenarioTabs = deps.scenarioTabs;
    this.scenarioExecution = deps.scenarioExecution;
    this.scenarioExecutionPool = deps.scenarioExecutionPool;
    this.suites = SuiteApp.create({
      suites: deps.suites,
      scenarios: deps.scenarios,
      projects: deps.projects,
      simulations: deps.simulations,
    });
    this.automation = AutomationApp.create({
      automation: deps.automation,
      monitors: deps.monitors,
      projects: deps.projects,
      featureFlags: deps.featureFlags,
    });
    this.organizationService = deps.organizations;
    this.organizations = OrganizationApp.create({
      organizations: deps.organizations,
      projects: deps.projects,
    });
    this.projects = ProjectApp.create({
      projects: deps.projects,
      apiKeys: deps.apiKeys,
      share: deps.share,
      topics: deps.topics,
      topicClustering: deps.commands.topicClustering,
    });
    this.users = UserApp.create({
      users: deps.users,
      auth: deps.auth,
      ops: deps.ops,
      organizations: deps.organizations,
    });
    this.roles = RoleApp.create({
      roles: deps.roles,
      permissions: deps.permissions,
      authzGrants: deps.authzGrants,
    });
    this.permissions = deps.permissions;
    this.authzApp = AuthzApp.create({ permissions: deps.permissions });
    this.authzGrants = deps.authzGrants;
    this.tokenizer = deps.tokenizer;
    this.usage = deps.usage;
    this.planProvider = deps.planProvider;
    this.subscription = deps.subscription;
    this.billingCustomer = deps.billingCustomer;
    this.webhookService = deps.webhookService;
    this.stripeClient = deps.stripeClient;
    this.notifications = deps.notifications;
    this.mailer = deps.mailer;
    this.auth = deps.auth;
    this.betterAuth = deps.betterAuth;
    this.nurturing = deps.nurturing;
    this.usageLimits = deps.usageLimits;
    this.broadcast = deps.broadcast;
    this.presence = deps.presence;
    this.secrets = SecretApp.create({ secrets: deps.secrets });
    const traces = { ...deps.traces, ...deps.commands.traces };
    this.evaluations = Object.assign(deps.evaluations, deps.commands.evaluations);
    this.analytics = AnalyticsApp.create({
      analytics: deps.analytics,
      filterOptions: deps.filters.options,
      langWatchQL: deps.langWatchQL,
    });
    this.langWatchQL = deps.langWatchQL;
    this.dashboard = DashboardApp.create({
      dashboard: deps.dashboard,
      automation: deps.automation,
    });
    this.simulations = deps.simulations;
    this.simulationExports = deps.simulationExports;
    this.topics = deps.topics;
    this.topicClustering = deps.commands.topicClustering;
    // `CodingAgentService` carries its behaviour on the prototype, so a spread
    // would copy the commands and silently drop every method. Same shape as
    // `evaluations` above.
    this.codingAgents = Object.assign(deps.codingAgents, deps.commands.codingAgents);
    this.codingAgentApp = CodingAgentApp.create({
      codingAgents: this.codingAgents,
      github: deps.github,
      scope: deps.codingAgentScope,
    });
    this.traceIngestion = {
      collection: deps.traces.collection,
      logCollection: deps.traces.logCollection,
      metricCollection: deps.traces.metricCollection,
    };
    this.traces = TraceApp.create({
      traces,
      topics: deps.topics,
      broadcast: deps.broadcast,
      evaluations: deps.evaluations,
      codingAgents: this.codingAgents,
      share: deps.share,
      projects: deps.projects,
    });
    this.gateway = deps.gateway;
    this.webhooks = WebhookApp.create({
      endpoints: deps.gateway.webhookEndpoints,
      health: deps.gateway.webhookHealth,
      events: deps.gateway.webhookEvents,
      assertEndpointsEntitled: assertWebhookEndpointsEntitled,
      dispatch: ({ destination, ...input }) => webhookDestinationFor(destination).send(input),
      runIdempotent: (input) => withIdempotency({ prisma, ...input }),
    });
    this.filters = deps.filters;
    this.clickhouse = deps.clickhouse;
    this.redis = deps.redis;
    this.billing = deps.billing;
    this.governance = deps.governance;
    this.governanceApp = GovernanceApp.create({
      governance: deps.governance,
      projects: deps.projects,
      organizations: deps.organizations,
      permissions: deps.permissions,
      // Post-collapse VirtualKey is organization-scoped; the
      // (organizationId, principalUserId, name) tuple is the personal-key
      // uniqueness contract. Both reads were supplied per mount in
      // `server/api/root.ts` before this.
      personalVirtualKeys: {
        isOrganizationMember: async ({ organizationId, userId }) =>
          (await prisma.organizationUser.findUnique({
            where: { userId_organizationId: { userId, organizationId } },
          })) !== null,
        hasActivePersonalKeyLabelled: async ({ organizationId, userId, label }) =>
          (await prisma.virtualKey.findFirst({
            where: {
              organizationId,
              principalUserId: userId,
              name: label,
              revokedAt: null,
            },
          })) !== null,
      },
    });
    this.billableEvents = deps.billableEvents;
    this.billingQueries = deps.billingQueries;
    this.commands = deps.commands;
    this.storedObjects = deps.storedObjects;
    // One object for both keys: the process's stored-object service answers
    // the portable capability AND the row-and-stream reads the file surface
    // makes. See `StoredObjectFileReadPort` for why the two are named apart.
    this.storedObjectApp = StoredObjectApp.create({
      storedObjects: deps.storedObjects,
      files: deps.storedObjects,
      owners: deps.storedObjectOwners,
    });
    this.userAvatarObjects = deps.userAvatarObjects;
    this.storedObjectOwners = deps.storedObjectOwners;
    this.opsExplain = deps.opsExplain;
    this.github = deps.github;
    this.langy = LangyApp.create({
      langy: deps.langy,
      redis: deps.redis,
      broadcast: deps.broadcast,
    });
    this.ops = OpsApp.create({
      ops: deps.ops,
      featureFlags: deps.featureFlags,
      projects: deps.projects,
    });
    this.dataRetention = deps.dataRetention;
    this.share = deps.share;
    this._eventSourcing = deps._eventSourcing;
    this._authzMigration = deps._authzMigration;
    this._shutdownResources = deps._shutdownResources ?? new AppShutdownResources();
  }

  /**
   * Shut down in order: drain the work, then close dependent resources before
   * the roots they use.
   *
   * These MUST NOT overlap. The resources include ClickHouse, Redis and Prisma
   * — the very connections the event-sourcing consumer is still issuing
   * statements over while it drains. Closing them concurrently destroys the
   * ClickHouse HTTP client mid-request, which the server reports as
   * `Broken pipe, while writing to socket ... ParallelFormattingOutputFormat`
   * and the driver reports back here as `socket hang up`. Every worker rollout
   * produced a burst of both (prod, 2026-08-10), because the drain has a 20s
   * budget and the close finished in milliseconds.
   *
   * The drain is bounded twice over: GroupQueueProcessor.close() races its own
   * shutdown timeout, and SHUTDOWN_BUDGET.appCloseMs is the backstop for
   * anything that escapes it. Both come from server/shutdown/budget.ts, which
   * derives them from one number so this backstop cannot end up shorter than
   * the drain it is supposed to outlive.
   *
   * `terminating` says whether the process is on its way out. It changes only
   * one thing — what to do when the drain times out — but the two callers need
   * opposite answers. A terminating process can leave the transports to its
   * own teardown, because closing them under a drain that is still running is
   * the severing this method exists to prevent. resetApp() is the other
   * caller and does NOT terminate: it relies on the closeables running to stop
   * Redis and Prisma handles leaking into the next test file, so it must close
   * them even then. Defaulting to false keeps the safe answer for anyone who
   * does not think about it.
   */
  async close({
    terminating = false,
  }: {
    terminating?: boolean;
  } = {}): Promise<void> {
    this.closePromise ??= this.closeOnce({ terminating });
    return this.closePromise;
  }

  private async closeOnce({ terminating }: { terminating: boolean }): Promise<void> {
    if (this._eventSourcing) {
      const eventSourcing = this._eventSourcing;
      const outcome = await settleWithTimeout({
        run: () => eventSourcing.close(),
        timeoutMs: SHUTDOWN_BUDGET.appCloseMs,
      });

      if (outcome.status === "timeout" && terminating) {
        // Still running. Closing the transports now would sever exactly the
        // in-flight statements this method exists to protect, reproducing the
        // incident on the timeout path. Leave them to process teardown: the
        // watchdog and then the kubelet end this pod within seconds either
        // way, and sockets die with the process regardless. Returning here
        // makes that a deliberate choice rather than a race we lose quietly.
        logger.error(
          { timeoutMs: SHUTDOWN_BUDGET.appCloseMs },
          "EventSourcing drain did not finish in time; leaving connections to process exit rather than severing in-flight work",
        );
        return;
      }

      if (outcome.status === "timeout") {
        // Not terminating, so nothing else will reclaim these handles.
        logger.error(
          { timeoutMs: SHUTDOWN_BUDGET.appCloseMs },
          "EventSourcing drain did not finish in time; closing connections anyway because this process is not shutting down",
        );
      }

      if (outcome.status === "failed") {
        // Finished, badly. Nothing is still writing, so the connections are
        // safe — and genuinely worth closing — unlike the timeout above.
        logger.error({ error: outcome.error }, "Failed to close EventSourcing");
      }
    }

    await this._shutdownResources.close();
  }
}

// Global access, thx turbopacc
export const globalForApp = globalThis as unknown as {
  __langwatch_app: App | null;
};
if (globalForApp.__langwatch_app === void 0) {
  globalForApp.__langwatch_app = null;
}

export function initializeApp(deps: AppDependencies): App {
  if (!globalForApp.__langwatch_app) {
    globalForApp.__langwatch_app = new App(deps);
  }
  return globalForApp.__langwatch_app;
}

export function getApp(): App {
  if (!globalForApp.__langwatch_app) {
    throw new Error("App not initialized. Call initializeDefaultApp() first.");
  }
  return globalForApp.__langwatch_app;
}

/**
 * The App if one has been initialized, otherwise `null`.
 *
 * **Use {@link getApp} unless absence is a supported outcome you can name.** A
 * path that needs the App and cannot run without it should fail loudly, not
 * read `null` and quietly take a lesser branch.
 *
 * Redis consumers are the main legitimate users, because Redis has always been
 * optional here: nearly all of them already branch on `if (!redis)` and have a
 * documented fallback — an in-memory counter, a skipped dedupe, an open-failed
 * rate limit, a 503. For those, "no App" and "no Redis" mean the same thing,
 * and raising would turn a working fallback into a crash on a path that was
 * built to survive exactly this.
 *
 * The consumers that keep {@link getApp} are the ones where doing less is not
 * a degraded success but a wrong answer — session revocation, where skipping
 * the Redis clear leaves a revoked user logged in.
 *
 * Never reach for this to avoid initializing an App. Nothing outside this
 * module should read {@link globalForApp} directly.
 */
export function tryGetApp(): App | null {
  return globalForApp.__langwatch_app;
}

/** Closes the optional legacy App from a process compatibility boundary. */
export async function closeInitializedApp(): Promise<void> {
  await tryGetApp()?.close();
}

export async function resetApp(): Promise<void> {
  // Close the previous App before dropping the singleton so its EventSourcing
  // and shutdown resources (Redis, queue workers, etc.) don't leak
  // into the next test. Without this the prior App is orphaned and its open
  // handles keep vitest's single fork worker from exiting between files.
  const existing = globalForApp.__langwatch_app;
  globalForApp.__langwatch_app = null;
  if (existing) {
    await existing.close();
  }
}
