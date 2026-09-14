import type { AnalyticsService } from "@langwatch/analytics-contract";
import {
  type AutomationClock,
  AutomationDispatchError,
  AutomationEmailCapService,
  type AutomationEmailCapRepository,
  type AutomationGraphActivity,
  AutomationLogger,
  type AutomationProjectIdentityPort,
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
import { WorkerAutomationNotificationDeliveryAdapter } from "../features/automation/automation-notification-delivery.adapter.ts";
import type { WorkerMailComposition } from "./worker-mail.composition.ts";
import { createWorkerWebhookTransport } from "./worker-webhook-egress.composition.ts";
import type { WorkerConfig } from "../platform/config/worker.config.ts";
import { nowInstant, toDate } from "@langwatch/time";

// Capabilities the graph vertical needs: project identity (narrowed from
// ProjectApi) and analytics for metric queries
export type WorkerAutomationGraphDependencies = Readonly<{
  projects: AutomationProjectIdentityPort;
  analytics: AnalyticsService;
}>;

// Shared transports, ceilings and cipher for both Automation halves to
// prevent double-spending budgets and secret key conflicts
export type WorkerAutomationDeliveryComposition = Readonly<{
  delivery: WorkerAutomationNotificationDeliveryAdapter;
  emailCaps: AutomationEmailCapService;
  crypto: AutomationSecretCrypto;
}>;

/**
 * Builds that shared trio, or reports that this process can send nothing.
 *
 * Nothing exactly when the deployment named no `BASE_HOST`. Every alert and
 * every digest carries links back to the deployment and a sender address
 * derived from the same host, so a process composed without one would render
 * mail nobody can act on.
 */
export function tryCreateWorkerAutomationDelivery(options: {
  config: WorkerConfig;
  mail: WorkerMailComposition | undefined;
  redis?: RedisConnection | null;
  webhookTransport?: WebhookDeliveryTransport;
  slackApiTransport?: SlackApiTransport;
  logger?: Logger;
}): WorkerAutomationDeliveryComposition | undefined {
  const { config, mail } = options;
  if (!config.mail || !mail) return undefined;

  const logger = options.logger ?? createLogger("langwatch:graph-trigger-automation");

  return {
    delivery: WorkerAutomationNotificationDeliveryAdapter.create({
      mailer: mail.delivery,
      renderer: mail.renderer,
      baseHost: mail.baseHost,
      ...(config.mail.unsubscribeSigningSecret === undefined
        ? {}
        : { unsubscribeSigningSecret: config.mail.unsubscribeSigningSecret }),
      // Defaulted rather than optional: a webhook destination is a URL the
      // CUSTOMER typed, and a process that composed delivery with a hole where
      // the fence goes would refuse every webhook automation by name. A caller
      // that wants to observe a dispatch without making one supplies its own.
      webhookTransport:
        options.webhookTransport ??
        createWorkerWebhookTransport({
          config,
          ...(options.redis === undefined ? {} : { redis: options.redis }),
        }),
      ...(options.slackApiTransport ? { slackApiTransport: options.slackApiTransport } : {}),
      logger,
    }),
    emailCaps: AutomationEmailCapService.create({
      store: options.redis ? createWorkerAutomationEmailCapRepository(options.redis) : null,
    }),
    crypto: resolveWorkerStoredSecretCipher(config),
  };
}

export type WorkerAutomationGraphCompositionOptions = Readonly<{
  config: WorkerConfig;
  /** The transports and ceilings this process's two Automation halves share. */
  delivery: WorkerAutomationDeliveryComposition;
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
  // SSRF-fenced sender for customer webhook URLs; defaulted to match the
  // application's own fence so tests can observe without side effects
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

// Composes the graph-alert vertical if BASE_HOST is set; absent means alerts
// cannot be sent (links back to deployment and sender address are derived from host)
export function tryCreateWorkerAutomationGraphComposition(
  options: WorkerAutomationGraphCompositionOptions,
): AutomationGraphActivity | undefined {
  const { config, mail } = options;
  if (!config.mail) return undefined;

  const logger = options.logger ?? createLogger("langwatch:graph-trigger-automation");
  const clock = new WorkerAutomationClock();

  return PostgresAutomationGraphActivityAdapter.create({
    prisma: options.prisma,
    clock,
    projects: options.dependencies.projects,
    analytics: options.dependencies.analytics,
    delivery: options.delivery.delivery,
    crypto: options.delivery.crypto,
    emailCaps: options.delivery.emailCaps,
    logger: new WorkerAutomationLogger(logger),
    dispatchErrors: new WorkerAutomationDispatchErrors(),
    baseHost: mail.baseHost,
    emailHourlyCap: config.automation.emailHourlyCap,
    tenantDailyCap: config.automation.tenantDailyCap,
  });
}

// Shared cipher for automation, webhook and governance credentials written
// under CREDENTIALS_SECRET by the control plane
export function resolveWorkerStoredSecretCipher(config: WorkerConfig): AutomationSecretCrypto {
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
export class WorkerAutomationClock implements AutomationClock {
  now() {
    return nowInstant();
  }
}

class WorkerAutomationLogger extends AutomationLogger {
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
class WorkerAutomationDispatchErrors extends AutomationDispatchError {
  isTerminal(error: unknown): boolean {
    return error instanceof DispatchError && !error.retryable;
  }

  createTerminal(message: string): unknown {
    return new DispatchError({ message, retryable: false });
  }
}

/**
 * The five Redis operations the email ceilings need, bound to the connection
 * here at the composition root so the cap service names a narrow capability
 * and never an ioredis client.
 */
function createWorkerAutomationEmailCapRepository(
  connection: RedisConnection,
): AutomationEmailCapRepository {
  return {
    claim: async (key, value, expiry, seconds, condition) =>
      (await connection.set(key, value, expiry, seconds, condition)) === null
        ? "already-claimed"
        : "claimed",
    findValue: (key) => connection.get(key),
    incr: (key) => connection.incr(key),
    incrby: (key, increment) => connection.incrby(key, increment),
    eval: (script, keyCount, key, seconds) => connection.eval(script, keyCount, key, seconds),
  };
}
