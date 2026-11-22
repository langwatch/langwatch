/**
 * The memory twin answers sessions used since a moment the way Postgres does.
 * @see modules/ops/specs/seat-sharing-check.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryAuthSessionRepository } from "../memory.auth-session.repository.ts";
import { MemoryAuthDatabase } from "../memory.auth.database.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 6, 9);

function repositoryWith(
  sessions: { userId: string; updatedAt: number; lastSeenAt: number | null }[],
): MemoryAuthSessionRepository {
  const memory = MemoryAuthDatabase.create();
  for (const [index, session] of sessions.entries()) {
    memory.db.Session.push({
      id: `session-${index}`,
      userId: session.userId,
      sessionToken: `token-${index}`,
      createdAt: new Date(session.updatedAt),
      updatedAt: new Date(session.updatedAt),
      lastSeenAt: session.lastSeenAt === null ? undefined : new Date(session.lastSeenAt),
      expires: new Date(NOW + 30 * DAY_MS),
    });
  }
  return MemoryAuthSessionRepository.create({ memory });
}

describe("memory auth sessions used since a moment", () => {
  /** @scenario "A session used or a sign-in in the window marks a person active" */
  it("answers a session rolled or seen in the window, never one that was neither", async () => {
    const repository = repositoryWith([
      { userId: "recent", updatedAt: NOW - DAY_MS, lastSeenAt: null },
      { userId: "seen", updatedAt: NOW - 40 * DAY_MS, lastSeenAt: NOW - DAY_MS },
      { userId: "stale", updatedAt: NOW - 40 * DAY_MS, lastSeenAt: NOW - 40 * DAY_MS },
    ]);

    const active = await repository.findSessionUsersSince({
      userIds: ["recent", "seen", "stale"],
      since: NOW - 30 * DAY_MS,
    });

    expect(active.toSorted()).toEqual(["recent", "seen"]);
  });
});
