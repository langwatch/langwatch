/**
 * @vitest-environment node
 * A sign-in in the window marks its person active for the Ops seat sharing check.
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

import { PrismaUserRepository } from "../prisma.user.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const RUN = `signed-in-since-${randomUUID()}`;
const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!databaseUrl)("Prisma users signed in since a moment", () => {
  let connection: PrismaConnection;
  let users: PrismaUserRepository;
  const ids: string[] = [];
  const now = Date.now();

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:user-signed-in-since:test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    users = PrismaUserRepository.create({ prisma: connection.client });
    for (const [name, lastLoginAt] of [
      ["yesterday", new Date(now - DAY_MS)],
      ["long-ago", new Date(now - 40 * DAY_MS)],
      ["never", null],
    ] as const) {
      const row = await connection.client.user.create({
        data: { name, email: `${name}@${RUN}.example.test`, lastLoginAt },
      });
      ids.push(row.id);
    }
  });

  afterAll(async () => {
    await connection.client.user.deleteMany({ where: { email: { contains: RUN } } });
    await connection.client.$disconnect();
  });

  /** @scenario "A session used or a sign-in in the window marks a person active" */
  it("answers only the person who signed in yesterday", async () => {
    const active = await users.findSignedInSince({ userIds: ids, since: now - 30 * DAY_MS });

    expect(active).toEqual([ids[0]]);
  });
});
