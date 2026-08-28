import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import type { SlackPayload } from "@langwatch/automation-contract";
import type { ProjectService } from "@langwatch/project-contract";
import {
  type AutomationClock,
  AutomationDispatchErrorPort,
  type AutomationGraphDeliveryPort,
  AutomationGraphNotifierPort,
  AutomationLoggerPort,
  AutomationHeartbeatPort,
  AutomationNotificationDeliveryPort,
  AutomationRunawayPort,
  AutomationSlackBotTokenDecryptorPort,
  GraphAlertDispatchService,
  WebhookProviderAdapter,
} from "@langwatch/automation-server";
import type {
  AutomationEmailCapService,
  GraphAlertDispatchInput,
  WebhookDeliveryRequest,
  WebhookSendResult,
} from "@langwatch/automation-server";
import { DispatchError } from "@langwatch/eventing";
import { createLogger, type Logger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";
import { nanoid } from "nanoid";
import type { Cluster, Redis } from "ioredis";
import type { SlackActionParams } from "@langwatch/automation-contract";
import { z } from "zod";
import {
  incrementAutomationAutoPausedTotal,
  incrementAutomationCeilingBreachTotal,
  incrementAutomationContainmentFailedTotal,
} from "~/server/metrics";
import { sendAutomationLimitEmail } from "~/server/mailer/automationLimitEmail";
import type { EmailDeliveryPort } from "~/server/mailer/providers/types";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { sendRenderedTriggerEmail, sendTriggerEmail } from "~/server/mailer/triggerEmail";
import {
  sendRenderedSlackMessage,
  sendSlackWebhook,
} from "~/runtime/app/features/automation-adapters/delivery/sendSlackWebhook";
import { deliverWebhook } from "~/runtime/app/features/automation-adapters/delivery/deliverWebhook";
import { postSlackChatMessage } from "~/runtime/app/features/automation-adapters/delivery/slackWebApi";
import { decryptSlackBotToken } from "~/runtime/app/features/automation-adapters/providers/slack/server";
import { decrypt, encrypt } from "~/utils/encryption";
import type { TriggerData } from "~/runtime/app/features/automation-adapters/trigger.types";
import type { AlertType } from "~/generated/prisma/client";

/** Named host capabilities supplied to the one process-owned AutomationService. */
export type AppAutomationGraphPorts = {
  emailCaps: AutomationEmailCapService;
  projects: ProjectService;
  analytics: AnalyticsService;
  notifier: AutomationGraphNotifierPort;
  baseHost: string;
  nextauthSecret?: string;
  logger: AutomationLoggerPort;
  slackTokens: AutomationSlackBotTokenDecryptorPort;
  dispatchErrors: AutomationDispatchErrorPort;
  heartbeat: AutomationHeartbeatPort;
  runaway: AutomationRunawayPort;
};

class AppAutomationLoggerAdapter extends AutomationLoggerPort {
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

class AppAutomationHeartbeatAdapter extends AutomationHeartbeatPort {
  constructor(private readonly resolveClient: ClickHouseClientResolver) {
    super();
  }
  tryResolveClickHouseClient(projectId: string) {
    return this.resolveClient(projectId);
  }
}

class AppAutomationSlackTokensAdapter extends AutomationSlackBotTokenDecryptorPort {
  tryDecrypt(params: SlackActionParams): string | null {
    return decryptSlackBotToken(params);
  }
}

class AppAutomationDispatchErrorsAdapter extends AutomationDispatchErrorPort {
  isTerminal(error: unknown): boolean {
    return error instanceof DispatchError && !error.retryable;
  }
  createTerminal(message: string): unknown {
    return new DispatchError({ message, retryable: false });
  }
}

const CLAIM_EXPIRE_SECONDS = 90_000;
const CLAIM_SWEEP_INTERVAL_MS = 60_000;
const claimMemory = new Map<string, { token: string; expiresAt: number }>();
let lastClaimSweepAt = 0;

function sweepExpiredClaims(now: number): void {
  if (now - lastClaimSweepAt < CLAIM_SWEEP_INTERVAL_MS) return;
  lastClaimSweepAt = now;
  for (const [key, claim] of claimMemory) {
    if (claim.expiresAt <= now) claimMemory.delete(key);
  }
}

async function claimOnce({
  connection,
  key,
  ttlSeconds = CLAIM_EXPIRE_SECONDS,
}: {
  connection: RedisConnection | null;
  key: string;
  ttlSeconds?: number;
}): Promise<{ key: string; token: string } | null> {
  const token = nanoid();
  if (connection) {
    try {
      const taken = await connection.set(key, token, "EX", ttlSeconds, "NX");
      return taken !== null ? { key, token } : null;
    } catch (error) {
      createLogger("langwatch:automations:runaway-containment").warn(
        { key, error: error instanceof Error ? error.message : String(error) },
        "Redis error claiming an automation containment notification; falling back to a per-worker claim",
      );
    }
  }
  const now = Date.now();
  sweepExpiredClaims(now);
  const existing = claimMemory.get(key);
  if (existing !== undefined && existing.expiresAt > now) return null;
  claimMemory.set(key, { token, expiresAt: now + ttlSeconds * 1000 });
  return { key, token };
}

const RELEASE_IF_OWNED_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

async function releaseClaim({
  connection,
  lease,
}: {
  connection: RedisConnection | null;
  lease: { key: string; token: string };
}): Promise<void> {
  if (connection) {
    try {
      await connection.eval(RELEASE_IF_OWNED_SCRIPT, 1, lease.key, lease.token);
    } catch (error) {
      createLogger("langwatch:automations:runaway-containment").warn(
        { key: lease.key, error: error instanceof Error ? error.message : String(error) },
        "Redis error releasing an automation containment claim; the fleet keeps it until expiry",
      );
    }
  }
  if (claimMemory.get(lease.key)?.token === lease.token) claimMemory.delete(lease.key);
}

class AppAutomationNotificationDeliveryAdapter extends AutomationNotificationDeliveryPort {
  constructor(
    private readonly mailer: EmailDeliveryPort,
    private readonly input: { baseHost: string; nextauthSecret: string | undefined },
  ) {
    super();
  }

  sendLegacyEmail(input: {
    recipients: string[];
    triggerData: TriggerData[];
    triggerName: string;
    triggerId: string;
    projectId: string;
    projectSlug: string;
    triggerType: AlertType | null;
    triggerMessage: string;
    isRecipientSent(recipientHash: string): Promise<boolean>;
    recordRecipientSent(recipientHash: string): Promise<void>;
  }): Promise<void> {
    return sendTriggerEmail({
      mailer: this.mailer,
      triggerEmails: input.recipients,
      triggerData: input.triggerData,
      triggerName: input.triggerName,
      triggerId: input.triggerId,
      projectId: input.projectId,
      projectSlug: input.projectSlug,
      triggerType: input.triggerType,
      triggerMessage: input.triggerMessage,
      isRecipientSent: input.isRecipientSent,
      recordRecipientSent: input.recordRecipientSent,
      baseHost: this.input.baseHost,
      nextauthSecret: this.input.nextauthSecret,
    });
  }

  sendEmail(input: {
    recipients: string[];
    triggerId: string;
    projectId: string;
    subject: string;
    html: string;
    isRecipientSent(recipientHash: string): Promise<boolean>;
    recordRecipientSent(recipientHash: string): Promise<void>;
  }): Promise<void> {
    return sendRenderedTriggerEmail({
      mailer: this.mailer,
      triggerEmails: input.recipients,
      triggerId: input.triggerId,
      projectId: input.projectId,
      subject: input.subject,
      html: input.html,
      isRecipientSent: input.isRecipientSent,
      recordRecipientSent: input.recordRecipientSent,
      baseHost: this.input.baseHost,
      nextauthSecret: this.input.nextauthSecret,
    });
  }

  sendSlackWebhook(input: {
    webhook: string;
    triggerName: string;
    payload: SlackPayload;
  }): Promise<void> {
    return sendRenderedSlackMessage({
      triggerWebhook: input.webhook,
      triggerName: input.triggerName,
      payload: input.payload,
    });
  }

  sendLegacySlackWebhook(input: {
    webhook: string;
    triggerData: TriggerData[];
    triggerName: string;
    projectSlug: string;
    triggerType: AlertType | null;
    triggerMessage: string;
    baseHost: string;
  }): Promise<void> {
    return sendSlackWebhook({
      triggerWebhook: input.webhook,
      triggerData: input.triggerData,
      triggerName: input.triggerName,
      projectSlug: input.projectSlug,
      triggerType: input.triggerType,
      triggerMessage: input.triggerMessage,
      baseHost: input.baseHost,
    });
  }

  sendSlackBot(input: {
    token: string;
    channel: string;
    payload: SlackPayload;
    triggerName: string;
  }): Promise<void> {
    return postSlackChatMessage(input);
  }

  sendWebhook(input: WebhookDeliveryRequest): Promise<WebhookSendResult> {
    return deliverWebhook(input);
  }
}

/** One named host adapter shared by graph and settled-trace delivery. */
export function createAutomationNotificationDeliveryPort(
  mailer: EmailDeliveryPort,
  input: { baseHost: string; nextauthSecret: string | undefined },
): AutomationNotificationDeliveryPort {
  return new AppAutomationNotificationDeliveryAdapter(mailer, input);
}

class AppAutomationGraphNotifierAdapter extends AutomationGraphNotifierPort {
  constructor(private readonly service: GraphAlertDispatchService) {
    super();
  }

  dispatch(input: GraphAlertDispatchInput) {
    return this.service.dispatch(input);
  }
}

/** Complete process capability set for the constructed AutomationService. */
export function createAutomationGraphPorts(input: {
  mailer: EmailDeliveryPort;
  redis: Redis | Cluster | null;
  clock: AutomationClock;
  emailCaps: AutomationEmailCapService;
  delivery: AutomationGraphDeliveryPort;
  projects: ProjectService;
  authz: AuthzService;
  analytics: AnalyticsService;
  resolveClickHouseClient: ClickHouseClientResolver;
  baseHost: string;
  nextauthSecret: string | undefined;
  emailHourlyCap: number;
  tenantDailyCap: number;
}): AppAutomationGraphPorts {
  const graphLogger = createLogger("langwatch:graph-trigger-automation");
  const logger = new AppAutomationLoggerAdapter(graphLogger);
  const notifier = GraphAlertDispatchService.create({
    persistence: input.delivery,
    emailCaps: input.emailCaps,
    delivery: createAutomationNotificationDeliveryPort(input.mailer, {
      baseHost: input.baseHost,
      nextauthSecret: input.nextauthSecret,
    }),
    webhooks: WebhookProviderAdapter.create({ encrypt, decrypt }),
    clock: input.clock,
    emailHourlyCap: input.emailHourlyCap,
    tenantDailyCap: input.tenantDailyCap,
  });

  return {
    emailCaps: input.emailCaps,
    projects: input.projects,
    analytics: input.analytics,
    notifier: new AppAutomationGraphNotifierAdapter(notifier),
    slackTokens: new AppAutomationSlackTokensAdapter(),
    dispatchErrors: new AppAutomationDispatchErrorsAdapter(),
    baseHost: input.baseHost,
    nextauthSecret: input.nextauthSecret,
    logger,
    heartbeat: new AppAutomationHeartbeatAdapter(input.resolveClickHouseClient),
    runaway: new AppAutomationRunawayAdapter({
      redis: input.redis,
      delivery: input.delivery,
      projects: input.projects,
      authz: input.authz,
      baseHost: input.baseHost,
      mailer: input.mailer,
      resolveClickHouseClient: input.resolveClickHouseClient,
    }),
  };
}

class AppAutomationRunawayAdapter extends AutomationRunawayPort {
  private readonly logger = createLogger("langwatch:automations:runaway-containment");

  constructor(
    private readonly input: {
      redis: Redis | Cluster | null;
      delivery: AutomationGraphDeliveryPort;
      projects: ProjectService;
      authz: AuthzService;
      baseHost: string;
      resolveClickHouseClient: ClickHouseClientResolver;
      mailer: EmailDeliveryPort;
    },
  ) {
    super();
  }

  async countProjectTraces24h(projectId: string): Promise<number> {
    const client = await this.input.resolveClickHouseClient(projectId);
    if (!client) return 0;
    const result = await client.query({
      query: `SELECT toString(count(DISTINCT TraceId)) AS Total FROM trace_summaries WHERE TenantId = {tenantId:String} AND OccurredAt >= now() - INTERVAL 24 HOUR`,
      query_params: { tenantId: projectId },
      format: "JSONEachRow",
    });
    const rows = z.array(z.object({ Total: z.string() })).parse(await result.json());
    return Number.parseInt(rows[0]?.Total ?? "0", 10);
  }

  async notificationRecipients(input: { projectId: string; triggerId: string }): Promise<string[]> {
    const { projectId, triggerId } = input;
    const organizationId = await this.input.projects.getOrganizationId(projectId);
    const bindings = await this.input.authz.listOrganizationBindings({ organizationId });
    const emails = [
      ...new Set(
        bindings.flatMap((binding) =>
          binding.role === "ADMIN" && binding.user?.email ? [binding.user.email] : [],
        ),
      ),
    ];
    if (emails.length === 0) return emails;
    try {
      return await this.input.delivery.filterSuppressed({ projectId, triggerId, emails });
    } catch (error) {
      this.logger.warn(
        {
          projectId,
          triggerId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Could not read the automation suppression list; notifying every administrator",
      );
      return emails;
    }
  }

  sendLimitEmail(params: {
    to: string[];
    kind: "ceiling_reached" | "paused";
    automationName: string;
    projectName: string;
    dailyCeiling: number;
    skippedToday: number;
    actionUrl: string;
  }): Promise<void> {
    return sendAutomationLimitEmail({ mailer: this.input.mailer, ...params });
  }

  tryClaimOnce(key: string, ttlSeconds?: number): Promise<{ key: string; token: string } | null> {
    return claimOnce({ connection: this.input.redis, key, ttlSeconds });
  }

  releaseClaim(lease: { key: string; token: string }): Promise<void> {
    return releaseClaim({ connection: this.input.redis, lease });
  }

  async projectName(projectId: string): Promise<string> {
    return (await this.input.projects.tryGetById(projectId))?.name ?? "your project";
  }

  async automationUrl(input: { projectId: string; triggerId: string }): Promise<string> {
    const project = await this.input.projects.tryGetById(input.projectId);
    return `${this.input.baseHost}/${project?.slug ?? ""}/automations?drawer.open=automation&drawer.automationId=${input.triggerId}`;
  }

  onCeilingBreach(): void {
    incrementAutomationCeilingBreachTotal();
  }
  onAutoPaused(): void {
    incrementAutomationAutoPausedTotal("runaway_volume");
  }
  onContainmentFailed(): void {
    incrementAutomationContainmentFailedTotal();
  }
  error(fields: Record<string, unknown>, message: string): void {
    this.logger.error(fields, message);
  }
  info(fields: Record<string, unknown>, message: string): void {
    this.logger.info(fields, message);
  }
}
