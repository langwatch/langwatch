import type { AnalyticsService } from "@langwatch/analytics-contract";
import {
  AutomationClockPort,
  AutomationDispatchErrorPort,
  AutomationEmailCapService,
  AutomationEmailCapStorePort,
  AutomationGraphActivityPort,
  AutomationLoggerPort,
  AutomationProjectIdentityPort,
  PostgresAutomationGraphActivityAdapter,
  type AutomationGraphActivityDatabase,
  type AutomationSecretCrypto,
  type SlackApiTransport,
  type WebhookDeliveryTransport,
} from "@langwatch/automation-server";
import { DispatchError } from "@langwatch/eventing";
import { createLogger, type Logger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";
import { AesGcmSecretEncryptionAdapter } from "@langwatch/secret-server";
import { WorkerAutomationNotificationDeliveryAdapter } from "../features/automation/automation-notification-delivery.adapter";
import type { WorkerMailComposition } from "./worker-mail.composition";
import { createWorkerWebhookTransport } from "./worker-webhook-egress.composition";
import type { WorkerConfig } from "../platform/config/worker.config";

/**
 * What this process still has to be HANDED before the graph vertical composes.
 *
 * ONE OF THE TWO CLEARED. `projects` was recorded here as a capability service
 * no background process could build — `ProjectService` needs a credentials
 * port, an organization service, the LWQL key map and stored objects. The
 * graph path asks it for one thing: the name and slug of the project an alert
 * is about. It is now `AutomationProjectIdentityPort`, which
 * `createWorkerTraceCapabilityServices` answers from a Prisma client and which
 * `ProjectService` still satisfies, so the application's own composition is
 * unchanged.
 *
 * `AnalyticsService` stays a parameter. It was never the wall — it is
 * `AnalyticsAdapter` over the ClickHouse resolver this process already holds —
 * and it arrives with the conversion that gives this process a reason to open
 * one, so that the day it does is a change in one composition root and nothing
 * else, and so that a test can compose the whole vertical today.
 */
export type WorkerAutomationGraphDependencies = Readonly<{
  projects: AutomationProjectIdentityPort;
  analytics: AnalyticsService;
}>;

export type WorkerAutomationGraphCompositionOptions = Readonly<{
  config: WorkerConfig;
  /**
   * The one database client this process opened, narrowed to the tables this
   * vertical touches. Naming generated Prisma is the feature's own business;
   * a composition root hands its client down and never spells the type.
   */
  prisma: AutomationGraphActivityDatabase;
  /** The process's outbound mail, and the host its links point at. */
  mail: WorkerMailComposition;
  dependencies: WorkerAutomationGraphDependencies;
  /**
   * The shared Redis the email ceilings count in. Absent falls back to
   * per-process counters, which is the application's own behaviour when Redis
   * is down: a ceiling enforced per pod rather than per fleet, and a burst that
   * is larger than intended but still bounded.
   */
  redis?: RedisConnection | null;
  /**
   * An SSRF-fenced outbound sender for customer-supplied webhook URLs.
   *
   * Defaulted to the one this process composes from `@langwatch/egress` and its
   * own Redis, so a webhook automation leaves here through the same fence the
   * application sends through. It stays a parameter because a test wants to
   * observe the request without making one, and because the delivery adapter
   * still has to refuse BY NAME in a process that composes no sender at all —
   * see `WorkerAutomationNotificationDeliveryAdapter`.
   */
  webhookTransport?: WebhookDeliveryTransport;
  /**
   * How this process reaches the Slack Web API.
   *
   * Defaulted to a direct HTTPS call, because both of that adapter's
   * destinations are constants under `slack.com` and nothing a customer typed
   * reaches it. A deployment that egresses through a proxy supplies its own.
   */
  slackApiTransport?: SlackApiTransport;
  logger?: Logger;
}>;

/**
 * Composes the graph-alert vertical, or reports that this process has none.
 *
 * Nothing exactly when the deployment named no `BASE_HOST`. Every alert this
 * path sends carries links back to the deployment — the automation's own page,
 * the graph it watches, the unsubscribe footer — and the sender address is
 * derived from the same host. A vertical composed without it would evaluate
 * correctly and then send mail nobody can act on, which is worse than a
 * process that says it cannot alert.
 *
 * It is a `tryCreate` for the same reason the mail capability is: what an
 * absent capability COSTS is decided by the graph that would have consumed it,
 * not here.
 */
export function tryCreateWorkerAutomationGraphComposition(
  options: WorkerAutomationGraphCompositionOptions,
): AutomationGraphActivityPort | undefined {
  const { config, mail } = options;
  if (!config.mail) return undefined;

  const logger = options.logger ?? createLogger("langwatch:graph-trigger-automation");
  const clock = new WorkerAutomationClock();

  return PostgresAutomationGraphActivityAdapter.create({
    prisma: options.prisma,
    clock,
    projects: options.dependencies.projects,
    analytics: options.dependencies.analytics,
    delivery: WorkerAutomationNotificationDeliveryAdapter.create({
      mailer: mail.delivery,
      baseHost: mail.baseHost,
      ...(config.mail.unsubscribeSigningSecret === undefined
        ? {}
        : { unsubscribeSigningSecret: config.mail.unsubscribeSigningSecret }),
      webhookTransport:
        options.webhookTransport ??
        createWorkerWebhookTransport({
          config,
          ...(options.redis === undefined ? {} : { redis: options.redis }),
        }),
      ...(options.slackApiTransport ? { slackApiTransport: options.slackApiTransport } : {}),
      logger,
    }),
    crypto: resolveAutomationCrypto(config),
    emailCaps: AutomationEmailCapService.create({
      store: options.redis ? new WorkerAutomationEmailCapStore(options.redis) : null,
    }),
    logger: new WorkerAutomationLogger(logger),
    dispatchErrors: new WorkerAutomationDispatchErrors(),
    baseHost: mail.baseHost,
    emailHourlyCap: config.automation.emailHourlyCap,
    tenantDailyCap: config.automation.tenantDailyCap,
  });
}

/**
 * The cipher stored automation credentials were written under, or one that
 * refuses.
 *
 * A deployment that never configured a key has no encrypted credential to
 * read, and its email and Slack-webhook automations work perfectly — so an
 * absent key must not stop the vertical composing. What it must not do either
 * is look like a cipher: a no-op that returned the ciphertext would hand a
 * Slack API an unusable token and produce an error from Slack about the
 * customer's own credentials.
 */
function resolveAutomationCrypto(config: WorkerConfig): AutomationSecretCrypto {
  const key = config.automation.credentialsEncryptionKey;

  return key ? AesGcmSecretEncryptionAdapter.create({ key }) : new UnconfiguredAutomationCrypto();
}

class UnconfiguredAutomationCrypto implements AutomationSecretCrypto {
  encrypt(): never {
    throw new Error(
      "This process holds no automation credentials key; set CREDENTIALS_SECRET to store or read encrypted automation credentials.",
    );
  }

  decrypt(): never {
    throw new Error(
      "This process holds no automation credentials key; set CREDENTIALS_SECRET to store or read encrypted automation credentials.",
    );
  }
}

/**
 * The one clock this process's automation reads.
 *
 * Exported because two verticals share it and must: the graph evaluator's
 * debounce and the trace-trigger cache's window are both measured against it,
 * and two clocks in one process is how a cache expires against a time the
 * evaluator has not reached.
 */
export class WorkerAutomationClock extends AutomationClockPort {
  now(): Date {
    return new Date();
  }
}

class WorkerAutomationLogger extends AutomationLoggerPort {
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
 * How this process's queue tells a permanent delivery failure from a retryable
 * one. It is the Eventing contract, so a graph composed here classifies exactly
 * as the application's does — a misread here would retry a dead payload forever
 * or dead-letter a transient one.
 */
class WorkerAutomationDispatchErrors extends AutomationDispatchErrorPort {
  isTerminal(error: unknown): boolean {
    return error instanceof DispatchError && !error.retryable;
  }

  createTerminal(message: string): unknown {
    return new DispatchError({ message, retryable: false });
  }
}

/**
 * The five Redis operations the email ceilings need, and no more.
 *
 * `AutomationEmailCapStorePort` is a nominal abstract class, so binding it to a
 * connection takes a class, and three of the five verbs already carry Redis's
 * own names — which is what makes this read to `layer-class` as a pass-through
 * layer. It is recorded in `overengineering-baseline.json` rather than
 * contorted: the alternative the policy suggests, holding the collaborator at
 * the caller, would mean handing the cap service an ioredis client and letting
 * a feature package name a transport it must not know about.
 */
class WorkerAutomationEmailCapStore extends AutomationEmailCapStorePort {
  constructor(private readonly connection: RedisConnection) {
    super();
  }

  trySet(
    key: string,
    value: string,
    expiry: "EX",
    seconds: number,
    condition: "NX",
  ): Promise<string | null> {
    return this.connection.set(key, value, expiry, seconds, condition);
  }

  tryGet(key: string): Promise<string | null> {
    return this.connection.get(key);
  }

  incr(key: string): Promise<number> {
    return this.connection.incr(key);
  }

  incrby(key: string, increment: number): Promise<number> {
    return this.connection.incrby(key, increment);
  }

  eval(script: string, keyCount: number, key: string, seconds: string): Promise<unknown> {
    return this.connection.eval(script, keyCount, key, seconds);
  }
}
