/**
 * The Postgres projection of presence (ADR-128, "Presence").
 *
 * Presence itself lives in Redis and dies with the socket. One thing reaches
 * the row: `lastSeenAt`, written at most once a minute per agent so the list
 * can say "last seen 2 hours ago" after every instance is gone, and so a
 * read knows which connected agents are still real.
 */

import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { AgentRepository } from "~/server/agents/agent.repository";
import { LAST_SEEN_WRITE_INTERVAL_MS } from "./constants";

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

/** Forgets every throttle mark, for tests that reuse the process. */
export function resetLastSeenThrottle(): void {
  lastWrites.clear();
}
