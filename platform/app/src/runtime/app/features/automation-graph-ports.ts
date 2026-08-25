import type { AnalyticsService } from "@langwatch/analytics-contract";
import type { ProjectService } from "@langwatch/project-contract";
import {
  AutomationDispatchErrorPort,
  AutomationGraphDeliveryPort,
  AutomationGraphNotifierPort,
  AutomationGraphTelemetryPort,
  AutomationHeartbeatPort,
  AutomationRunawayPort,
  AutomationSlackBotTokenDecryptorPort,
} from "@langwatch/automation-server";
import type { GraphAlertDispatchInput } from "@langwatch/automation-server";
import { DispatchError } from "@langwatch/eventing";
import { createLogger, type Logger } from "@langwatch/observability";
import type { RedisConnection } from "@langwatch/redis-client";
import { nanoid } from "nanoid";
import type { Cluster, Redis } from "ioredis";
import { OrganizationUserRole, type PrismaClient } from "~/generated/prisma/client";
import type { SlackActionParams } from "@langwatch/automation-contract";
import {
  incrementAutomationAutoPausedTotal,
  incrementAutomationCeilingBreachTotal,
  incrementAutomationContainmentFailedTotal,
} from "~/server/metrics";
import { sendAutomationLimitEmail } from "~/server/mailer/automationLimitEmail";
import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { sendRenderedTriggerEmail } from "~/server/mailer/triggerEmail";
import { sendWebhook } from "~/server/webhooks/sendWebhook";
import {
  consumeEmailCapSlot,
  consumeTenantEmailCapSlot,
} from "~/server/app-layer/automations/dispatch/emailCaps";
import { dispatchGraphAlertAction } from "~/server/app-layer/automations/dispatch/graphAlertActionDispatch";
import { sendRenderedSlackMessage } from "~/server/app-layer/automations/delivery/sendSlackWebhook";
import { postSlackChatMessage } from "~/server/app-layer/automations/delivery/slackWebApi";
import { decryptSlackBotToken } from "~/server/app-layer/automations/providers/slack/server";

/** Named host capabilities supplied to the one process-owned AutomationService. */
export type AppAutomationGraphPorts = {
  projects: ProjectService;
  analytics: AnalyticsService;
  notifier: AutomationGraphNotifierPort;
  baseHost: string;
  telemetry: AutomationGraphTelemetryPort;
  slackTokens: AutomationSlackBotTokenDecryptorPort;
  dispatchErrors: AutomationDispatchErrorPort;
  heartbeat: AutomationHeartbeatPort;
  runaway: AutomationRunawayPort;
};

class AppAutomationTelemetryAdapter extends AutomationGraphTelemetryPort {
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

class AppAutomationGraphNotifierAdapter extends AutomationGraphNotifierPort {
  constructor(
    private readonly input: {
      delivery: AutomationGraphDeliveryPort;
      redis: Redis | Cluster | null;
      emailHourlyCap: number;
      tenantDailyCap: number;
    },
  ) {
    super();
  }

  dispatch(input: GraphAlertDispatchInput) {
    return dispatchGraphAlertAction({
      deps: {
        sendEmail: sendRenderedTriggerEmail,
        sendSlack: sendRenderedSlackMessage,
        sendSlackBot: postSlackChatMessage,
        sendWebhook,
        recordWebhookDelivery: (value) =>
          this.input.delivery.recordWebhookDelivery(value),
        filterSuppressedRecipients: (value) =>
          this.input.delivery.filterSuppressed(value),
        consumeEmailCapSlot: ({ projectId, triggerId, now, dedupKey }) =>
          consumeEmailCapSlot({
            projectId,
            triggerId,
            now,
            cap: this.input.emailHourlyCap,
            dedupKey,
            redis: this.input.redis,
          }),
        emailHourlyCap: this.input.emailHourlyCap,
        consumeTenantEmailCapSlot: ({ projectId, now, cap, recipientCount, dedupKey }) =>
          consumeTenantEmailCapSlot({
            projectId,
            now,
            cap,
            recipientCount,
            dedupKey,
            redis: this.input.redis,
          }),
        tenantDailyCap: this.input.tenantDailyCap,
        isRecipientSent: (value) => this.input.delivery.isSendClaimed(value),
        recordRecipientSent: async (value) => {
          await this.input.delivery.claimSend(value);
        },
      },
      input,
    });
  }
}

/** Complete process capability set for the constructed AutomationService. */
export function createAutomationGraphPorts(input: {
  database: PrismaClient;
  redis: Redis | Cluster | null;
  delivery: AutomationGraphDeliveryPort;
  projects: ProjectService;
  analytics: AnalyticsService;
  resolveClickHouseClient: ClickHouseClientResolver;
  baseHost: string;
  emailHourlyCap: number;
  tenantDailyCap: number;
}): AppAutomationGraphPorts {
  const graphLogger = createLogger("langwatch:graph-trigger-automation");
  const telemetry = new AppAutomationTelemetryAdapter(graphLogger);

  return {
    projects: input.projects,
    analytics: input.analytics,
    notifier: new AppAutomationGraphNotifierAdapter({
      delivery: input.delivery,
      redis: input.redis,
      emailHourlyCap: input.emailHourlyCap,
      tenantDailyCap: input.tenantDailyCap,
    }),
    slackTokens: new AppAutomationSlackTokensAdapter(),
    dispatchErrors: new AppAutomationDispatchErrorsAdapter(),
    baseHost: input.baseHost,
    telemetry,
    heartbeat: new AppAutomationHeartbeatAdapter(input.resolveClickHouseClient),
    runaway: new AppAutomationRunawayAdapter({
      prisma: input.database,
      redis: input.redis,
      delivery: input.delivery,
      projects: input.projects,
      baseHost: input.baseHost,
      resolveClickHouseClient: input.resolveClickHouseClient,
    }),
  };
}

class AppAutomationRunawayAdapter extends AutomationRunawayPort {
  private readonly logger = createLogger("langwatch:automations:runaway-containment");

  constructor(
    private readonly input: {
      prisma: PrismaClient;
      redis: Redis | Cluster | null;
      delivery: AutomationGraphDeliveryPort;
      projects: ProjectService;
      baseHost: string;
      resolveClickHouseClient: ClickHouseClientResolver;
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
    const rows = (await result.json()) as Array<{ Total: string }>;
    return Number.parseInt(rows[0]?.Total ?? "0", 10);
  }

  async notificationRecipients(input: {
    projectId: string;
    triggerId: string;
  }): Promise<string[]> {
    const { projectId, triggerId } = input;
    const organizationId = await this.input.projects.getOrganizationId(projectId);
    const admins = await this.input.prisma.organizationUser.findMany({
      where: { organizationId, role: OrganizationUserRole.ADMIN },
      select: { user: { select: { email: true } } },
    });
    const emails = admins.flatMap((admin: { user: { email: string | null } }) =>
      admin.user.email ? [admin.user.email] : [],
    );
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
    return sendAutomationLimitEmail(params);
  }

  tryClaimOnce(
    key: string,
    ttlSeconds?: number,
  ): Promise<{ key: string; token: string } | null> {
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
