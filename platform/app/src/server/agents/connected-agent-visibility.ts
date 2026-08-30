/**
 * When a connected agent still counts as present (ADR-128, "Presence").
 *
 * A connected agent writes `lastSeenAt` while its process holds a socket. An
 * agent not seen for thirty days no longer appears in the agents list and is
 * refused as a run target. Nothing is written to say so: the row comes back
 * as soon as the process connects again and writes `lastSeenAt`.
 *
 * The module holds no framework import, so the browser can read the same
 * predicate the server reads.
 *
 * @see specs/agents/connected-agents.feature
 */

import type { Prisma } from "~/generated/prisma/client";

/** A connected agent unseen this long is treated as gone. */
export const CONNECTED_AGENT_UNSEEN_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The oldest `lastSeenAt` that still counts as present. */
export function connectedAgentSeenCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - CONNECTED_AGENT_UNSEEN_DAYS * DAY_MS);
}

/**
 * Whether the presence of a connected agent is too old to count.
 *
 * A row with no `lastSeenAt` is never stale: only a connected agent writes
 * the column, and it writes it on the register that creates the row.
 */
export function isConnectedAgentStale({
  lastSeenAt,
  now = new Date(),
}: {
  lastSeenAt: Date | string | null | undefined;
  now?: Date;
}): boolean {
  if (!lastSeenAt) return false;
  return (
    new Date(lastSeenAt).getTime() < connectedAgentSeenCutoff(now).getTime()
  );
}

/**
 * The Prisma fragment that keeps a stale connected agent out of a read.
 *
 * Spread it into a `where` that declares no `OR` of its own. Every other
 * agent type has no presence, so only connected rows are filtered.
 */
export function connectedAgentVisibleWhere({
  now = new Date(),
}: {
  now?: Date;
} = {}): Pick<Prisma.AgentWhereInput, "OR"> {
  return {
    OR: [
      { type: { not: "connected" } },
      { lastSeenAt: null },
      { lastSeenAt: { gte: connectedAgentSeenCutoff(now) } },
    ],
  };
}
