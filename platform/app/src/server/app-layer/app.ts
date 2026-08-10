import { createLogger } from "@langwatch/observability";
import type { EventSourcing } from "../event-sourcing/eventSourcing";
import type { AppCommands } from "../event-sourcing/pipelineRegistry";
import { SHUTDOWN_BUDGET } from "../shutdown/budget";
import type { AppConfig } from "./config";
import type {
  AppDependencies,
  DataRetentionDependencies,
  OpsDependencies,
} from "./dependencies";

const logger = createLogger("langwatch:app");

type SettleOutcome =
  | { status: "done" }
  | { status: "failed"; error: unknown }
  | { status: "timeout" };

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

  readonly broadcast: AppDependencies["broadcast"];
  readonly presence: AppDependencies["presence"];
  readonly traces: AppDependencies["traces"] & AppCommands["traces"];
  readonly evaluations: AppDependencies["evaluations"] &
    AppCommands["evaluations"];
  readonly experimentRuns: AppCommands["experimentRuns"];
  readonly dspySteps: AppDependencies["dspySteps"];
  /** The ADR-034 analytics read API. */
  readonly analytics: AppDependencies["analytics"];
  readonly simulations: AppDependencies["simulations"] &
    AppCommands["simulations"];
  readonly suiteRuns: AppDependencies["suiteRuns"] & AppCommands["suiteRuns"];
  readonly topicClustering: AppDependencies["topicClustering"] &
    AppCommands["topicClustering"];
  readonly codingAgents: AppDependencies["codingAgents"] &
    AppCommands["codingAgents"];
  readonly gateway: AppDependencies["gateway"];
  readonly filters: AppDependencies["filters"];
  readonly clickhouse: AppDependencies["clickhouse"];
  /**
   * The process's one Redis connection, or `null` when none is configured.
   * See {@link AppDependencies.redis} — inject where you can, read it here
   * inside the handler where you cannot.
   */
  readonly redis: AppDependencies["redis"];
  readonly billing: AppDependencies["billing"];
  readonly usageStats: AppDependencies["usageStats"];
  readonly scenarios: AppDependencies["scenarios"];
  readonly governance: AppDependencies["governance"];
  readonly billableEvents: AppDependencies["billableEvents"];
  readonly commands: AppCommands;
  readonly storedObjects: AppDependencies["storedObjects"];
  readonly opsExplain: AppDependencies["opsExplain"];
  readonly github: AppDependencies["github"];
  readonly langy: AppDependencies["langy"];
  readonly experiments: AppDependencies["experiments"];
  readonly triggers: AppDependencies["triggers"];
  readonly triggerTemplates: AppDependencies["triggerTemplates"];
  readonly emailSuppressions: AppDependencies["emailSuppressions"];
  readonly organizations: AppDependencies["organizations"];
  readonly projects: AppDependencies["projects"];
  readonly tokenizer: AppDependencies["tokenizer"];
  readonly usage: AppDependencies["usage"];
  readonly planProvider: AppDependencies["planProvider"];
  readonly subscription?: AppDependencies["subscription"];
  readonly webhookService?: AppDependencies["webhookService"];
  readonly stripeClient?: AppDependencies["stripeClient"];
  readonly notifications: AppDependencies["notifications"];
  readonly nurturing?: AppDependencies["nurturing"];
  readonly usageLimits: AppDependencies["usageLimits"];
  readonly ops?: OpsDependencies;
  readonly retentionPolicyCache: AppDependencies["retentionPolicyCache"];
  readonly dataRetention: DataRetentionDependencies;
  readonly share: AppDependencies["share"];
  readonly sharedTraceCache: AppDependencies["sharedTraceCache"];

  /** Keeps EventSourcing infrastructure safe from the greedy garbage men */
  private readonly _eventSourcing?: EventSourcing;

  get eventSourcing(): EventSourcing | undefined {
    return this._eventSourcing;
  }
  private readonly _gracefulCloseables: Array<{
    name: string;
    close: () => Promise<void>;
  }>;

  constructor(deps: AppDependencies) {
    this.config = deps.config;
    this.experiments = deps.experiments;
    this.triggers = deps.triggers;
    this.triggerTemplates = deps.triggerTemplates;
    this.emailSuppressions = deps.emailSuppressions;
    this.organizations = deps.organizations;
    this.projects = deps.projects;
    this.tokenizer = deps.tokenizer;
    this.usage = deps.usage;
    this.planProvider = deps.planProvider;
    this.subscription = deps.subscription;
    this.webhookService = deps.webhookService;
    this.stripeClient = deps.stripeClient;
    this.notifications = deps.notifications;
    this.nurturing = deps.nurturing;
    this.usageLimits = deps.usageLimits;
    this.broadcast = deps.broadcast;
    this.presence = deps.presence;
    this.traces = { ...deps.traces, ...deps.commands.traces };
    this.evaluations = { ...deps.evaluations, ...deps.commands.evaluations };
    this.experimentRuns = deps.commands.experimentRuns;
    this.dspySteps = deps.dspySteps;
    this.analytics = deps.analytics;
    this.simulations = { ...deps.simulations, ...deps.commands.simulations };
    this.suiteRuns = { ...deps.suiteRuns, ...deps.commands.suiteRuns };
    this.topicClustering = {
      ...deps.topicClustering,
      ...deps.commands.topicClustering,
    };
    this.codingAgents = {
      ...deps.codingAgents,
      ...deps.commands.codingAgents,
    };
    this.gateway = deps.gateway;
    this.filters = deps.filters;
    this.clickhouse = deps.clickhouse;
    this.redis = deps.redis;
    this.billing = deps.billing;
    this.usageStats = deps.usageStats;
    this.scenarios = deps.scenarios;
    this.governance = deps.governance;
    this.billableEvents = deps.billableEvents;
    this.commands = deps.commands;
    this.storedObjects = deps.storedObjects;
    this.opsExplain = deps.opsExplain;
    this.github = deps.github;
    this.langy = deps.langy;
    this.ops = deps.ops;
    this.retentionPolicyCache = deps.retentionPolicyCache;
    this.dataRetention = deps.dataRetention;
    this.share = deps.share;
    this.sharedTraceCache = deps.sharedTraceCache;
    this._eventSourcing = deps._eventSourcing;
    this._gracefulCloseables = deps._gracefulCloseables ?? [];
  }

  /**
   * Shut down in two ordered phases: drain the work, then drop the transports
   * it was using.
   *
   * These MUST NOT overlap. The graceful closeables are ClickHouse, Redis and
   * Prisma — the very connections the event-sourcing consumer is still issuing
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

    await Promise.allSettled(
      this._gracefulCloseables.map(async (c) => {
        try {
          await c.close();
        } catch (error) {
          logger.error({ name: c.name, error }, "Failed to close");
        }
      }),
    );
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
 * **Prefer {@link getApp}.** A path that needs the App and cannot run without
 * it should fail loudly, not read `null` and quietly take a lesser branch.
 *
 * This exists for the few consumers whose *documented contract* is to degrade
 * when there is nothing to reach — `TtlCache`, which is specified as
 * "Redis available: shared across pods; no Redis configured: in-memory only".
 * Those are constructed at module scope and used from paths that may run
 * before, or entirely without, a composition root; throwing there would turn a
 * working fallback into a crash.
 *
 * Reach for this only when absence is a supported outcome you can name, and
 * never as a way to avoid initializing an App. Nothing outside this module
 * should read {@link globalForApp} directly.
 */
export function tryGetApp(): App | null {
  return globalForApp.__langwatch_app;
}

export async function resetApp(): Promise<void> {
  // Close the previous App before dropping the singleton so its EventSourcing
  // and graceful-closeable handles (Redis, queue workers, etc.) don't leak
  // into the next test. Without this the prior App is orphaned and its open
  // handles keep vitest's single fork worker from exiting between files.
  const existing = globalForApp.__langwatch_app;
  globalForApp.__langwatch_app = null;
  if (existing) {
    await existing.close();
  }
}
