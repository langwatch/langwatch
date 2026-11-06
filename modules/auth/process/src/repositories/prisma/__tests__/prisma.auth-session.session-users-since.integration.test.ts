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
const stale = `${namespace}-stale`;

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
    for (const [id, usedAt] of [
      [recent, now - DAY_MS],
      [stale, now - 40 * DAY_MS],
    ] as const) {
      await prisma.user.create({ data: { id, email: `${id}@example.com`, name: id } });
      await prisma.session.create({
        data: {
          id: `${id}-session`,
          sessionToken: `${id}-token`,
          userId: id,
          expires: new Date(now + 30 * DAY_MS),
          createdAt: new Date(usedAt),
          updatedAt: new Date(usedAt),
        },
      });
    }
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.client.session.deleteMany({ where: { userId: { in: [recent, stale] } } });
    await connection.client.user.deleteMany({ where: { id: { in: [recent, stale] } } });
    await connection.closeOnce();
  });

  /** @scenario "A session used or a sign-in in the window marks a person active" */
  it("answers only the person whose session was used yesterday", async () => {
    const active = await repository.findSessionUsersSince({
      userIds: [recent, stale],
      since: now - 30 * DAY_MS,
    });

    expect(active).toEqual([recent]);
  });

  it("answers nobody for no people", async () => {
    await expect(
      repository.findSessionUsersSince({ userIds: [], since: now - 30 * DAY_MS }),
    ).resolves.toEqual([]);
  });
});
