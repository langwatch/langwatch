/**
 * The Postgres projection of presence (ADR-128, "Presence").
 *
 * Presence itself lives in Redis and dies with the socket. Two things reach
 * the row: `lastSeenAt`, written at most once a minute per agent so the list
 * can say "last seen 2 hours ago" after every instance is gone, and the daily
 * sweep that archives a connected agent unseen for thirty days.
 */

import { createLogger } from "@langwatch/observability";
import { Prisma, type PrismaClient } from "~/generated/prisma/client";
import { AgentRepository } from "~/server/agents/agent.repository";
import { ARCHIVE_AFTER_DAYS, LAST_SEEN_WRITE_INTERVAL_MS } from "./constants";

const logger = createLogger("langwatch:connected-agents:presence");

/** When each agent's row was last written by this process. */
const lastWrites = new Map<string, number>();

/**
 * Writes `lastSeenAt` unless this process wrote it inside the last minute.
 *
 * The throttle is per process on purpose: with N replicas the row is written
 * at most N times a minute, which is still nothing, and a shared throttle
 * would cost a Redis round trip to save a Postgres one.
 */
export async function touchAgentLastSeen({
  prisma,
  projectId,
  agentId,
  now = Date.now(),
  intervalMs = LAST_SEEN_WRITE_INTERVAL_MS,
}: {
  prisma: PrismaClient;
  projectId: string;
  agentId: string;
  now?: number;
  intervalMs?: number;
}): Promise<boolean> {
  const key = `${projectId}:${agentId}`;
  const last = lastWrites.get(key);
  if (last !== undefined && now - last < intervalMs) return false;
  lastWrites.set(key, now);
  try {
    await new AgentRepository(prisma).touchLastSeenAt({
      id: agentId,
      projectId,
      at: new Date(now),
    });
    return true;
  } catch (error) {
    lastWrites.delete(key);
    logger.warn({ error, projectId, agentId }, "lastSeenAt write failed");
    return false;
  }
}

/** Test seam: forget every throttle mark. */
export function resetLastSeenThrottle(): void {
  lastWrites.clear();
}

/**
 * Archives every connected agent unseen for {@link ARCHIVE_AFTER_DAYS}.
 *
 * One statement across every project, by design: the sweep is a platform
 * chore, not a tenant read, and the tenancy guard is told so.
 */
export async function archiveUnseenConnectedAgents({
  prisma,
  now = new Date(),
  archiveAfterDays = ARCHIVE_AFTER_DAYS,
}: {
  prisma: PrismaClient;
  now?: Date;
  archiveAfterDays?: number;
}): Promise<number> {
  const cutoff = new Date(
    now.getTime() - archiveAfterDays * 24 * 60 * 60 * 1000,
  );
  const count = await prisma.$executeRaw(
    Prisma.sql`
      -- @tenancy: daily sweep over every project; archives connected agents unseen for ${Prisma.raw(String(archiveAfterDays))} days
      UPDATE "Agent"
      SET "archivedAt" = ${now}
      WHERE "type" = 'connected'
        AND "archivedAt" IS NULL
        AND "lastSeenAt" IS NOT NULL
        AND "lastSeenAt" < ${cutoff}
    `,
  );
  if (count > 0) {
    logger.info(
      { count, cutoff },
      "archived connected agents unseen for too long",
    );
  }
  return count;
}
