/**
 * @vitest-environment node
 * A browser session used in the window marks its person active for the Ops seat sharing check.
 * @see modules/ops/specs/seat-sharing-check.feature
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaAuthSessionRepository } from "../prisma.auth-session.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const namespace = `test-session-users-since-${randomUUID()}`;
const DAY_MS = 24 * 60 * 60 * 1000;
const recent = `${namespace}-recent`;
const seen = `${namespace}-seen`;
const stale = `${namespace}-stale`;
const people = [recent, seen, stale];

describe.skipIf(!databaseUrl)("Prisma auth sessions used since a moment", () => {
  let connection: PrismaConnection;
  let repository: PrismaAuthSessionRepository;
  const now = Date.now();

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:auth:test:session-users-since"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    const prisma = connection.client;
    repository = PrismaAuthSessionRepository.create({ prisma });
    // recent: rolled yesterday, never seen; seen: rolled long ago, seen yesterday; stale: neither.
    for (const [id, updatedAt, lastSeenAt] of [
      [recent, now - DAY_MS, null],
      [seen, now - 40 * DAY_MS, now - DAY_MS],
      [stale, now - 40 * DAY_MS, now - 40 * DAY_MS],
    ] as const) {
      await prisma.user.create({ data: { id, email: `${id}@example.com`, name: id } });
      await prisma.session.create({
        data: {
          id: `${id}-session`,
          sessionToken: `${id}-token`,
          userId: id,
          expires: new Date(now + 30 * DAY_MS),
          createdAt: new Date(updatedAt),
          updatedAt: new Date(updatedAt),
          lastSeenAt: lastSeenAt === null ? null : new Date(lastSeenAt),
        },
      });
    }
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.client.session.deleteMany({ where: { userId: { in: people } } });
    await connection.client.user.deleteMany({ where: { id: { in: people } } });
    await connection.closeOnce();
  });

  /** @scenario "A session used or a sign-in in the window marks a person active" */
  it("answers a session rolled or seen in the window, never one that was neither", async () => {
    const active = await repository.findSessionUsersSince({
      userIds: people,
      since: now - 30 * DAY_MS,
    });

    expect(active.toSorted()).toEqual([recent, seen].toSorted());
  });

  it("answers nobody for no people", async () => {
    await expect(
      repository.findSessionUsersSince({ userIds: [], since: now - 30 * DAY_MS }),
    ).resolves.toEqual([]);
  });
});
