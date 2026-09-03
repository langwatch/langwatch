/**
 * The automation application this process serves `automation.*` and
 * `emailSuppression.*` from.
 *
 * A project's triggers are rows: what fires them, what they deliver to, how
 * many times a day they may persist, and who asked to stop receiving them. The
 * API process READS and WRITES those rows. It does not RUN them — no trigger
 * is evaluated here, no email or Slack message is delivered here, no schedule
 * is woken here. That work is the worker's, and it composes the same feature
 * over a different half (`worker-automation-settlement.composition.ts`).
 *
 * So the six capabilities below that belong to the running half are named
 * absences rather than second implementations. Each refuses BY NAME at the one
 * procedure that reaches it, which is the difference between "this deployment
 * does not test-fire from its API" and a test fire that silently reports
 * success having sent nothing.
 *
 *   graph notifier          a graph alert is dispatched by the worker.
 *   runaway containment     the daily ceiling is enforced where the fires
 *                           happen.
 *   test fire               a test delivery goes out over the worker's
 *                           transports.
 *   heartbeat ClickHouse    the graph heartbeat's recency query.
 *   dispatch errors         retryable-versus-terminal is a delivery
 *                           distinction, and nothing here delivers.
 *
 * Two capabilities are the exception, and both for the same reason: they are
 * STORAGE, not running.
 *
 *   persist cap             a READ on this process — the trigger list shows
 *                           how much of today's ceiling each automation has
 *                           spent — over the same Redis counter the worker
 *                           spends against.
 *   report calendar / wake  the row a saved report schedule IS, over the same
 *                           `ScheduledJob` store the worker's loop claims
 *                           through. Writing a calendar row is a Postgres
 *                           write; only the loop that wakes it is the worker's,
 *                           and this process never runs one.
 */
import {
  AutomationPersistCapService,
  AutomationApp,
  AutomationClockPort,
  AutomationGraphNotifierPort,
  AutomationDispatchErrorPort,
  AutomationHeartbeatPort,
  AutomationLoggerPort,
  AutomationProviderRegistryAdapter,
  AutomationRunawayPort,
  AutomationSlackBotTokenDecryptorPort,
  AutomationTestFirePort,
  HmacUnsubscribeTokenAdapter,
  PostgresAutomationAdapter,
  SchedulerWakePort,
  type AutomationPersistCapRedisPort,
  type ClaimLease,
} from "@langwatch/automation-server";
import type { AnalyticsService } from "@langwatch/analytics-contract";
import type {
  AutomationPersistCapConfig,
  AutomationPlanProvider,
  SlackActionParams,
} from "@langwatch/automation-contract";
import { PrismaScheduledJobStore, SchedulerService } from "@langwatch/eventing/server";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import { HandledError } from "@langwatch/handled-error";
import type { MonitorService } from "@langwatch/monitor-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";

/**
 * The platform application's persist ceilings, stated here.
 *
 * Stated rather than read from configuration because they are the DEPLOYMENT
 * defaults every install has run on, and reading them from an unset variable
 * would silently give every free project the paid ceiling.
 */
const PERSIST_CAP: AutomationPersistCapConfig = { free: 50, paid: 500, enterprise: 5_000 };

/** A capability the API process deliberately does not run, refused by name. */
class ApiAutomationUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `The API process does not ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiAutomationUnavailableError";
  }
}

export type ApiAutomationCompositionOptions = Readonly<{
  /** The one guarded connection every trigger row is read and written on. */
  prisma: PrismaClient;
  /** The project directory a trigger's own project is named through. */
  projects: ProjectService;
  /** The monitors a trigger watches, named in the trigger list. */
  monitors: MonitorService;
  /** The rollout gate the webhook channel is behind. */
  featureFlags: FeatureFlagService;
  /** Which plan an organization is on, for the persist ceiling. */
  plans: AutomationPlanProvider;
  /** The provider registry, already bound to this deployment's cipher. */
  providers: AutomationProviderRegistryAdapter;
  /** The signing key an unsubscribe link is verified with. */
  unsubscribeSecret: string | undefined;
  /** This deployment's public origin, for the links a trigger's mail carries. */
  baseHost: string;
  /** The SAME Redis the worker spends the persist ceiling against. */
  redis: RedisConnection | null;
  /** Names this process in every refusal above. */
  processName: string;
}>;

/** Composes the automation application over this process's own graph. */
export function composeApiAutomationApp(options: ApiAutomationCompositionOptions): AutomationApp {
  const logger = createLogger(`${options.processName}:automation`);
  const clock = new ApiAutomationClock();

  const automation = PostgresAutomationAdapter.create({
    database: options.prisma,
    verifier: HmacUnsubscribeTokenAdapter.create({ secret: options.unsubscribeSecret }),
    // The report calendar, on the SAME `ScheduledJob` store the worker's loop
    // claims a due row through — Eventing's own, not a second narrowing of it,
    // so the row this process writes on save is the row that process reads.
    // Storing a schedule is one guarded Postgres write and needs no loop; the
    // loop stays where the fires are.
    jobs: new PrismaScheduledJobStore(options.prisma),
    clock,
    wake: new ApiSchedulerWake(options.redis, logger),
    projects: options.projects,
    // Nothing here evaluates a graph automation — the worker does — so the
    // charted reads a graph trigger would be measured against refuse by name
    // rather than being composed a second time on this process.
    analytics: unevaluatedGraphAnalytics(),
    notifier: new UndeliveredApiGraphAlerts(),
    baseHost: options.baseHost,
    logger: new ApiAutomationLogger(logger),
    slackTokens: new ApiAutomationSlackTokens(options.providers),
    dispatchErrors: new ApiAutomationDispatchErrors(),
    heartbeat: new UnmeasuredApiAutomationHeartbeat(),
    runaway: new UncontainedApiAutomationRunaway(logger),
    testFire: new UndeliverableApiTestFire(),
    persistCaps: AutomationPersistCapService.create({
      projects: options.projects,
      planProvider: options.plans,
      config: PERSIST_CAP,
      redis: options.redis as AutomationPersistCapRedisPort | null,
    }),
  }).build();

  return AutomationApp.create({
    automation,
    monitors: options.monitors,
    projects: options.projects,
    featureFlags: options.featureFlags,
  });
}

/**
 * The charted reads a graph automation is evaluated against, absent.
 *
 * Every method refuses by name. A graph trigger is evaluated where the fires
 * happen, and a series this process answered would be a threshold nobody acts
 * on.
 */
function unevaluatedGraphAnalytics(): AnalyticsService {
  return new Proxy({} as AnalyticsService, {
    get: () => () => {
      throw new ApiAutomationUnavailableError("evaluate graph automations");
    },
    has: () => true,
  });
}

/** The process's own wall clock, as the feature reads time. */
class ApiAutomationClock extends AutomationClockPort {
  now(): Date {
    return new Date();
  }
}

/**
 * The cross-process wake a freshly written schedule publishes, best-effort.
 *
 * The worker's loop subscribes to it, so a report saved here comes due there
 * without waiting for the poll backstop. Postgres is the correctness layer:
 * the row is already written by the time this runs, so a dropped publish or an
 * absent Redis costs the time to the worker's next sweep, never a fire.
 */
class ApiSchedulerWake extends SchedulerWakePort {
  constructor(
    private readonly redis: RedisConnection | null,
    private readonly logger: Pick<Logger, "debug">,
  ) {
    super();
  }

  publish(): void {
    if (!this.redis) {
      this.logger.debug(
        {},
        "no Redis to wake the automation scheduler on: the worker picks the change up on its next sweep",
      );
      return;
    }

    SchedulerService.publishWake(this.redis as never);
  }
}

/** Graph alerts are dispatched by the worker, so this one refuses by name. */
class UndeliveredApiGraphAlerts extends AutomationGraphNotifierPort {
  dispatch(): never {
    throw new ApiAutomationUnavailableError("deliver graph alerts");
  }
}

/** The feature's log lines, on this process's own logger. */
class ApiAutomationLogger extends AutomationLoggerPort {
  constructor(private readonly logger: Logger) {
    super();
  }

  error(fields: Record<string, unknown>, message: string): void {
    this.logger.error(fields, message);
  }

  debug(fields: Record<string, unknown>, message: string): void {
    this.logger.debug(fields, message);
  }

  info(fields: Record<string, unknown>, message: string): void {
    this.logger.info(fields, message);
  }

  warn(fields: Record<string, unknown>, message: string): void {
    this.logger.warn(fields, message);
  }
}

/**
 * The stored Slack bot token, read through the SAME registry the transport
 * redacts with — one cipher, so a token stored by one door is readable by the
 * other.
 */
class ApiAutomationSlackTokens extends AutomationSlackBotTokenDecryptorPort {
  constructor(private readonly providers: AutomationProviderRegistryAdapter) {
    super();
  }

  tryDecrypt(params: SlackActionParams): string | null {
    return this.providers.decryptSlackBotToken(params);
  }
}

/**
 * Retryable versus terminal, for a process that delivers nothing.
 *
 * Every failure reads as terminal here, which is the safe reading: this
 * process has no queue to retry on, so a failure it called retryable would
 * simply be lost.
 */
class ApiAutomationDispatchErrors extends AutomationDispatchErrorPort {
  isTerminal(): boolean {
    return true;
  }

  createTerminal(message: string): unknown {
    return new Error(message);
  }
}

/** The heartbeat's recency query has no endpoint here. */
class UnmeasuredApiAutomationHeartbeat extends AutomationHeartbeatPort {
  tryResolveClickHouseClient(): Promise<null> {
    return Promise.resolve(null);
  }
}

/**
 * Runaway containment, for a process that fires nothing.
 *
 * The reads answer emptily and the writes refuse: containment is a decision
 * taken where a fire happens, and a ceiling this process claimed to enforce
 * would be a ceiling nobody actually counts against.
 */
class UncontainedApiAutomationRunaway extends AutomationRunawayPort {
  constructor(private readonly logger: Logger) {
    super();
  }

  countProjectTraces24h(): Promise<number> {
    return Promise.resolve(0);
  }

  notificationRecipients(): Promise<string[]> {
    return Promise.resolve([]);
  }

  sendLimitEmail(): Promise<void> {
    return Promise.reject(new ApiAutomationUnavailableError("send automation limit mail"));
  }

  tryClaimOnce(): Promise<ClaimLease | null> {
    return Promise.resolve(null);
  }

  releaseClaim(): Promise<void> {
    return Promise.resolve();
  }

  projectName(projectId: string): Promise<string> {
    return Promise.resolve(projectId);
  }

  automationUrl(): Promise<string> {
    return Promise.resolve("");
  }

  onCeilingBreach(): void {
    this.logger.warn({}, "an automation reached its daily persist ceiling");
  }

  onAutoPaused(reason: string): void {
    this.logger.warn({ reason }, "an automation was paused by containment");
  }

  onContainmentFailed(): void {
    this.logger.warn({}, "automation containment could not complete");
  }

  error(fields: Record<string, unknown>, message: string): void {
    this.logger.error(fields, message);
  }

  info(fields: Record<string, unknown>, message: string): void {
    this.logger.info(fields, message);
  }
}

/** A test fire goes out over the worker's transports, never this process's. */
class UndeliverableApiTestFire extends AutomationTestFirePort {
  sendEmail(): Promise<void> {
    return Promise.reject(new ApiAutomationUnavailableError("send a test email"));
  }

  sendSlack(): Promise<void> {
    return Promise.reject(new ApiAutomationUnavailableError("send a test Slack message"));
  }

  sendSlackBot(): Promise<void> {
    return Promise.reject(new ApiAutomationUnavailableError("send a test Slack message"));
  }

  sendWebhook(): Promise<{ status: number }> {
    return Promise.reject(new ApiAutomationUnavailableError("send a test webhook"));
  }
}
