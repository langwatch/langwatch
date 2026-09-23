import type { AuthzService } from "@langwatch/authz-contract";
import type { AutomationLimitNextStep } from "@langwatch/automation-contract";
import { generate } from "@langwatch/ksuid";
import { sendAutomationLimitEmail } from "@langwatch/mail";
import type { EmailDelivery } from "@langwatch/notification-process";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { nowInstant } from "@langwatch/time";
import { z } from "zod";

import {
  AutomationRunaway,
  type ClaimLease,
} from "../repositories/automation-runaway.repository.ts";
import type { AutomationHeartbeat } from "./automation-graph-runtime.service.ts";
import type { AutomationRunawayMetricsSink } from "./automation-runaway-metrics.service.ts";

/**
 * Who a limit notice goes to, resolved through this process's own
 * directories. Two collaborators: a project breaches the ceiling, but its
 * admins are named on the ORGANIZATION, so the project directory bridges them.
 */
export type AutomationRunawayDirectories = Readonly<{
  projects: Pick<ProjectApi, "getOrganizationId" | "findById">;
  authorization: Pick<AuthzService, "listOrganizationBindings">;
}>;

/** The routed client a project's traces are counted on. */
export type RunawayClickHouseResolver = AutomationHeartbeat["findClickHouseClient"];

/** Which addresses this project has already asked not to hear from again. */
export type AutomationRunawaySuppression = Readonly<{
  filterSuppressed(input: {
    projectId: string;
    triggerId: string;
    emails: string[];
  }): Promise<string[]>;
}>;

/**
 * Where a project's organization can go for a higher ceiling. Optional: a
 * deployment that composed no self-serve catalogue still contains a runaway
 * automation, it just names no upgrade in the mail.
 */
export type AutomationNextStepResolver = Readonly<{
  resolve(projectId: string): Promise<AutomationLimitNextStep | undefined>;
}>;

/**
 * Infrastructure for Automation's runaway containment, in this process. Owns the
 * substrates that policy names (trace counts, admin roll, mailer, etc.).
 */
export class AutomationRunawayAdapter extends AutomationRunaway {
  static create(input: {
    redis: RedisConnection | null;
    directories: AutomationRunawayDirectories;
    suppression: AutomationRunawaySuppression;
    mailer: EmailDelivery;
    resolveClickHouseClient: RunawayClickHouseResolver;
    metrics: AutomationRunawayMetricsSink;
    baseHost: string;
    /** Absent on a deployment that composed no self-serve plan catalogue. */
    nextStep?: AutomationNextStepResolver | null;
    logger?: Logger;
  }): AutomationRunawayAdapter {
    return new AutomationRunawayAdapter(
      input,
      input.logger ?? createLogger("langwatch:automation:runaway-containment"),
    );
  }

  private constructor(
    private readonly input: {
      redis: RedisConnection | null;
      directories: AutomationRunawayDirectories;
      suppression: AutomationRunawaySuppression;
      mailer: EmailDelivery;
      resolveClickHouseClient: RunawayClickHouseResolver;
      metrics: AutomationRunawayMetricsSink;
      baseHost: string;
      nextStep?: AutomationNextStepResolver | null;
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
    nextStep?: AutomationLimitNextStep;
  }): Promise<void> {
    return sendAutomationLimitEmail({ mailer: this.input.mailer, ...params });
  }

  async findNextStep(projectId: string): Promise<AutomationLimitNextStep | undefined> {
    return this.input.nextStep?.resolve(projectId);
  }

  async claimOnce(key: string, ttlSeconds?: number): Promise<ClaimLease | "already-claimed"> {
    const lease = await claimOnce({
      connection: this.input.redis,
      key,
      ttlSeconds,
      logger: this.logger,
    });
    return lease ?? "already-claimed";
  }

  releaseClaim(lease: ClaimLease): Promise<void> {
    return releaseClaim({ connection: this.input.redis, lease, logger: this.logger });
  }

  async projectName(projectId: string): Promise<string> {
    return (await this.input.directories.projects.findById(projectId))?.name ?? "your project";
  }

  async automationUrl(input: { projectId: string; triggerId: string }): Promise<string> {
    const project = await this.input.directories.projects.findById(input.projectId);

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
 * The app's KSUID resource for a containment-notice claim's fencing token
 * (`KSUID_RESOURCES.AUTOMATION_CLAIM`), as a literal: only ever compared for
 * equality, never persisted, but the kind still says what the token is for.
 */
const AUTOMATION_CLAIM_KSUID_RESOURCE = "automationclaim";

/**
 * The per-pod fallback when Redis is unreachable. Notifies once per pod rather
 * than not at all (which would silently leave runaway automations uncontained).
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
  const token = generate(AUTOMATION_CLAIM_KSUID_RESOURCE).toString();
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

  const now = nowInstant().epochMilliseconds;
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
