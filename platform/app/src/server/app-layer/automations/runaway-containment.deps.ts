import { createLogger } from "@langwatch/observability";
import { OrganizationUserRole, type PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";

import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { sendAutomationLimitEmail } from "~/server/mailer/automationLimitEmail";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import { connection } from "~/server/redis";
import type { ProjectService } from "../projects/project.service";
import type { EmailSuppressionService } from "./emailSuppression.service";
import type {
  ClaimLease,
  RunawayContainmentDeps,
} from "./runaway-containment.service";
import type { TriggerService } from "./trigger.service";

const logger = createLogger("langwatch:automations:runaway-containment");

/** 25h, one hour past the day the claim covers, matching the cap counters. */
const CLAIM_EXPIRE_SECONDS = 90_000;

/**
 * The fallback map holds one entry per claim for up to 25h, so during a long
 * Redis outage it has to be swept or it grows for the whole outage. Sweeping is
 * time-gated rather than size-gated: a size gate would put a full scan on every
 * claim once the map crossed its threshold, and mid-outage that scan deletes
 * nothing because nothing has expired yet.
 */
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

/**
 * Once-only gate across the fleet. Redis SET-NX when it is available; a
 * per-worker Map otherwise, which degrades "one email per day" to "one per
 * worker per day" rather than to none at all.
 *
 * The value is a fresh token rather than a constant, so a later release can
 * prove it owns the claim it is dropping. See `ClaimLease`.
 */
async function claimOnce(
  key: string,
  ttlSeconds: number = CLAIM_EXPIRE_SECONDS,
): Promise<ClaimLease | null> {
  const token = nanoid();
  if (connection) {
    try {
      const taken = await connection.set(key, token, "EX", ttlSeconds, "NX");
      return taken !== null ? { key, token } : null;
    } catch (error) {
      logger.warn(
        { key, error: error instanceof Error ? error.message : String(error) },
        "Redis error claiming an automation containment notification, " +
          "falling back to a per-worker claim",
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

/**
 * Deletes only a key still holding this lease's token, so a release cannot
 * drop a claim that has since been retaken. Read and delete go in one script
 * because as two round trips another worker can claim the key in between, and
 * the delete would then land on the new holder.
 */
const RELEASE_IF_OWNED_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/**
 * Gives a claim back. Used when the thing the claim was meant to dedupe did not
 * happen, so the next attempt can retake it rather than waiting out a TTL that
 * can be a whole day.
 *
 * Both stores are asked, not one: a claim can land in Redis and the release can
 * arrive while Redis is unreachable, and the memory map is where this worker
 * would then look. Each store drops the claim only while this lease still owns
 * it, which is what keeps a release from crossing into another worker's claim.
 */
async function releaseClaim(lease: ClaimLease): Promise<void> {
  if (connection) {
    try {
      await connection.eval(RELEASE_IF_OWNED_SCRIPT, 1, lease.key, lease.token);
    } catch (error) {
      logger.warn(
        {
          key: lease.key,
          error: error instanceof Error ? error.message : String(error),
        },
        "Redis error releasing an automation containment claim, the fleet " +
          "keeps it until it expires",
      );
    }
  }
  if (claimMemory.get(lease.key)?.token === lease.token) {
    claimMemory.delete(lease.key);
  }
}

export function defaultRunawayContainmentDeps({
  prisma,
  triggers,
  projects,
  emailSuppressions,
  baseHost,
  resolveClickHouseClient,
}: {
  prisma: PrismaClient;
  triggers: TriggerService;
  projects: ProjectService;
  emailSuppressions: EmailSuppressionService;
  baseHost: string;
  resolveClickHouseClient: ClickHouseClientResolver;
}): RunawayContainmentDeps {
  return {
    countProjectTraces24h: async (projectId) => {
      const client = await resolveClickHouseClient(projectId);
      if (!client) return 0;
      const result = await client.query({
        query: `
          SELECT toString(count(DISTINCT TraceId)) AS Total
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND OccurredAt >= now() - INTERVAL 24 HOUR
        `,
        query_params: { tenantId: projectId },
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as Array<{ Total: string }>;
      return parseInt(rows[0]?.Total ?? "0", 10);
    },

    pauseTrigger: async ({ triggerId, projectId, reason, at }) => {
      await triggers.update({
        triggerId,
        projectId,
        data: { active: false, pausedReason: reason, pausedAt: at },
      });
      // Without this the match subscriber keeps recording matches for up to
      // the cache TTL, which is the whole window the pause exists to close.
      await triggers.invalidate(projectId);
    },

    notificationRecipients: async ({ projectId, triggerId }) => {
      const organizationId = await resolveOrganizationId(projectId);
      if (!organizationId) return [];
      const admins = await prisma.organizationUser.findMany({
        where: { organizationId, role: OrganizationUserRole.ADMIN },
        select: { user: { select: { email: true } } },
      });
      const emails = admins.flatMap((admin) =>
        admin.user.email ? [admin.user.email] : [],
      );
      if (emails.length === 0) return emails;

      // ADR-031: an admin who unsubscribed from this project's automation mail
      // is not mailed about its limits either. Fails open, because a
      // suppression-store failure must not swallow the one mail that explains
      // why an automation stopped producing records.
      try {
        return await emailSuppressions.filterSuppressed({
          projectId,
          triggerId,
          emails,
        });
      } catch (error) {
        logger.warn(
          {
            projectId,
            triggerId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Could not read the email suppression list for an automation limit " +
            "email, notifying every admin",
        );
        return emails;
      }
    },

    sendLimitEmail: (params) => sendAutomationLimitEmail(params),

    claimOnce,
    releaseClaim,

    projectName: async (projectId) =>
      (await projects.getById(projectId))?.name ?? "your project",

    // The authoring drawer (`openDrawer("automation", { automationId })`) is
    // the only surface that can edit a query-based condition, which is exactly
    // what the mail asks the customer to narrow.
    automationUrl: async ({ projectId, triggerId }) => {
      const project = await projects.getById(projectId);
      const slug = project?.slug ?? "";
      return `${baseHost}/${slug}/automations?drawer.open=automation&drawer.automationId=${triggerId}`;
    },
  };
}
