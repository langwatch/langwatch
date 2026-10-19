/**
 * @vitest-environment node
 * The install's first-created account against a real Postgres: deactivation never moves it.
 * Rows are dated far before any real account, since the table is shared by every suite.
 * Spec: modules/user/specs/user.feature
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

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const RUN = `first-${randomUUID()}`;

describe.skipIf(!databaseUrl)("given accounts created one after another", () => {
  let connection: PrismaConnection;
  let firstId: string;
  let laterId: string;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:user-first-created:test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    const first = await connection.client.user.create({
      data: {
        name: `First ${RUN}`,
        email: `first@${RUN}.acme.test`,
        createdAt: new Date("1000-01-01T00:00:00Z"),
      },
    });
    const later = await connection.client.user.create({
      data: {
        name: `Later ${RUN}`,
        email: `later@${RUN}.acme.test`,
        createdAt: new Date("1000-01-02T00:00:00Z"),
      },
    });
    firstId = first.id;
    laterId = later.id;
  });

  afterAll(async () => {
    await connection.client.user.deleteMany({ where: { email: { contains: RUN } } });
    await connection.client.$disconnect();
  });

  /** @scenario "The install's first-created account is answered by id" */
  it("answers the earliest-created account, and still it once deactivated", async () => {
    const users = PrismaUserRepository.create({ prisma: connection.client });

    await expect(users.findFirstCreatedId()).resolves.toBe(firstId);

    await connection.client.user.update({
      where: { id: firstId },
      data: { deactivatedAt: new Date("1000-01-03T00:00:00Z") },
    });
    const answer = await users.findFirstCreatedId();
    expect(answer).toBe(firstId);
    expect(answer).not.toBe(laterId);
  });
});
