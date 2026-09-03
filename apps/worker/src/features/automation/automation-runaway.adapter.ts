import {
  AutomationHeartbeatPort,
  AutomationRunawayMetricsSink,
  AutomationRunawayPort,
  type ClaimLease,
} from "@langwatch/automation-server";
import type { AuthzService } from "@langwatch/authz-contract";
import { sendAutomationLimitEmail } from "@langwatch/mail";
import type { EmailDeliveryPort } from "@langwatch/notification-server";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ProjectService } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { nanoid } from "nanoid";
import { z } from "zod";

/**
 * Who a limit notice goes to, resolved through this process's own directories.
 *
 * Two collaborators rather than one because a project's admins are an
 * ORGANIZATION's role bindings: the ceiling is breached by a project, the
 * people who can do something about it are named on its organization, and the
 * hop between the two is the project directory's answer.
 */
export type WorkerAutomationRunawayDirectories = Readonly<{
  projects: Pick<ProjectService, "getOrganizationId" | "tryGetById">;
  authorization: Pick<AuthzService, "listOrganizationBindings">;
}>;

/** The routed client a project's traces are counted on. */
export type WorkerRunawayClickHouseResolver = AutomationHeartbeatPort["tryResolveClickHouseClient"];

/** Which addresses this project has already asked not to hear from again. */
export type WorkerAutomationRunawaySuppression = Readonly<{
  filterSuppressed(input: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }): Promise<string[]>;
}>;

/**
 * The infrastructure behind Automation's runaway containment, in this process.
 *
 * The POLICY is `RunawayContainmentService`'s — when an automation counts as
 * misconfigured, whether this pod may be the one to pause it, and how often an
 * organization may be told. What this adapter owns is the six substrates that
 * policy names: the project's 24-hour trace count, the admin roll, the mailer,
 * the fleet-wide claim leases, the deployment's own links, and the three
 * counters.
 *
 * Recovered from the platform application's adapter rather than rewritten, so
 * the pause a customer sees from a background process is the pause they saw
 * from the interactive one — the same ClickHouse count, the same ADMIN-only
 * roll, the same suppression fall-open, the same claim keys.
 */
export class WorkerAutomationRunawayAdapter extends AutomationRunawayPort {
  static create(input: {
    redis: RedisConnection | null;
    directories: WorkerAutomationRunawayDirectories;
    suppression: WorkerAutomationRunawaySuppression;
    mailer: EmailDeliveryPort;
    resolveClickHouseClient: WorkerRunawayClickHouseResolver;
    metrics: AutomationRunawayMetricsSink;
    baseHost: string;
    logger?: Logger;
  }): WorkerAutomationRunawayAdapter {
    return new WorkerAutomationRunawayAdapter(
      input,
      input.logger ?? createLogger("langwatch:automation:runaway-containment"),
    );
  }

  private constructor(
    private readonly input: {
      redis: RedisConnection | null;
      directories: WorkerAutomationRunawayDirectories;
      suppression: WorkerAutomationRunawaySuppression;
      mailer: EmailDeliveryPort;
      resolveClickHouseClient: WorkerRunawayClickHouseResolver;
      metrics: AutomationRunawayMetricsSink;
      baseHost: string;
    },
    private readonly logger: Logger,
  ) {
    super();
  }

  async countProjectTraces24h(projectId: string): Promise<number> {
    const client = await this.input.resolveClickHouseClient(projectId);
    if (!client) return 0;
    const result = await client.query({
      query:
        "SELECT toString(count(DISTINCT TraceId)) AS Total FROM trace_summaries WHERE TenantId = {tenantId:String} AND OccurredAt >= now() - INTERVAL 24 HOUR",
      query_params: { tenantId: projectId },
      format: "JSONEachRow",
    });
    const rows = z.array(z.object({ Total: z.string() })).parse(await result.json());

    return Number.parseInt(rows[0]?.Total ?? "0", 10);
  }

  async notificationRecipients(input: { projectId: string; triggerId: string }): Promise<string[]> {
    const { projectId, triggerId } = input;
    const organizationId = await this.input.directories.projects.getOrganizationId(projectId);
    const bindings = await this.input.directories.authorization.listOrganizationBindings({
      organizationId,
    });
    const emails = [
      ...new Set(
        bindings.flatMap((binding) =>
          binding.role === "ADMIN" && binding.user?.email ? [binding.user.email] : [],
        ),
      ),
    ];
    if (emails.length === 0) return emails;

    try {
      return await this.input.suppression.filterSuppressed({ projectId, triggerId, emails });
    } catch (error) {
      // Fall OPEN. A suppression list this process cannot read is a reason to
      // mail an administrator one message they might have muted, not a reason
      // to leave a runaway automation uncontained and nobody told.
      this.logger.warn(
        { projectId, triggerId, error: error instanceof Error ? error.message : String(error) },
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

  tryClaimOnce(key: string, ttlSeconds?: number): Promise<ClaimLease | null> {
    return claimOnce({ connection: this.input.redis, key, ttlSeconds, logger: this.logger });
  }

  releaseClaim(lease: ClaimLease): Promise<void> {
    return releaseClaim({ connection: this.input.redis, lease, logger: this.logger });
  }

  async projectName(projectId: string): Promise<string> {
    return (await this.input.directories.projects.tryGetById(projectId))?.name ?? "your project";
  }

  async automationUrl(input: { projectId: string; triggerId: string }): Promise<string> {
    const project = await this.input.directories.projects.tryGetById(input.projectId);

    return `${this.input.baseHost}/${project?.slug ?? ""}/automations?drawer.open=automation&drawer.automationId=${input.triggerId}`;
  }

  onCeilingBreach(): void {
    this.input.metrics.onCeilingBreach();
  }

  onAutoPaused(reason: string): void {
    this.input.metrics.onAutoPaused(reason);
  }

  onContainmentFailed(): void {
    this.input.metrics.onContainmentFailed();
  }

  error(fields: Record<string, unknown>, message: string): void {
    this.logger.error(fields, message);
  }

  info(fields: Record<string, unknown>, message: string): void {
    this.logger.info(fields, message);
  }
}

const CLAIM_EXPIRE_SECONDS = 90_000;
const CLAIM_SWEEP_INTERVAL_MS = 60_000;

/**
 * The per-pod fallback, and why it is not a second lease.
 *
 * A claim exists so one pod out of the fleet sends the mail. Redis is what
 * makes it fleet-wide; when Redis is unreachable the choice is between
 * notifying once per pod and notifying not at all, and not at all is the
 * failure that leaves a runaway automation silently uncontained. So the memory
 * map is deliberately the weaker guarantee, taken only after Redis has failed.
 */
const claimMemory = new Map<string, { token: string; expiresAt: number }>();
let lastClaimSweepAt = 0;

function sweepExpiredClaims(now: number): void {
  if (now - lastClaimSweepAt < CLAIM_SWEEP_INTERVAL_MS) return;
  lastClaimSweepAt = now;
  for (const [key, claim] of claimMemory) {
    if (claim.expiresAt <= now) claimMemory.delete(key);
  }
}

async function claimOnce(input: {
  connection: RedisConnection | null;
  key: string;
  ttlSeconds?: number;
  logger: Logger;
}): Promise<ClaimLease | null> {
  const { connection, key, ttlSeconds = CLAIM_EXPIRE_SECONDS } = input;
  const token = nanoid();
  if (connection) {
    try {
      const taken = await connection.set(key, token, "EX", ttlSeconds, "NX");

      return taken !== null ? { key, token } : null;
    } catch (error) {
      input.logger.warn(
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

async function releaseClaim(input: {
  connection: RedisConnection | null;
  lease: ClaimLease;
  logger: Logger;
}): Promise<void> {
  const { connection, lease } = input;
  if (connection) {
    try {
      await connection.eval(RELEASE_IF_OWNED_SCRIPT, 1, lease.key, lease.token);
    } catch (error) {
      input.logger.warn(
        { key: lease.key, error: error instanceof Error ? error.message : String(error) },
        "Redis error releasing an automation containment claim; the fleet keeps it until expiry",
      );
    }
  }
  if (claimMemory.get(lease.key)?.token === lease.token) claimMemory.delete(lease.key);
}
