/**
 * @vitest-environment node
 * An operator's account search against a real Postgres: address, name or id, case aside.
 * Spec: modules/ops/specs/feature-flag-target-search.feature
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
const RUN = `search-${randomUUID()}`;
const UNDERSCORE_RUN = `underscore-${randomUUID()}`;

describe.skipIf(!databaseUrl)("given accounts an operator searches", () => {
  let connection: PrismaConnection;
  const danaId = `user-dana-${RUN}`;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("Test database URL is required");
    connection = PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("langwatch:user:test:search"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }));
    await connection.client.user.createMany({
      data: [
        { id: danaId, name: "Dana Reyes", email: `dana@${RUN}.acme.test` },
        { name: `Kay ${RUN}`, email: `kay@${RUN}.other.test` },
        { name: "Ann Lee", email: `ann_lee@${UNDERSCORE_RUN}.acme.test` },
        { name: "Annalee", email: `annalee@${UNDERSCORE_RUN}.acme.test` },
      ],
    });
  });

  afterAll(async () => {
    if (!connection) return;
    try {
      await connection.client.user.deleteMany({
        where: { OR: [{ email: { contains: RUN } }, { email: { contains: UNDERSCORE_RUN } }] },
      });
    } finally {
      await connection.closeOnce();
    }
  });

  it("reads an underscore in the query as itself, not as any character", async () => {
    const repository = PrismaUserRepository.create({ prisma: connection.client });

    const found = await repository.searchProfiles({
      query: `ann_lee@${UNDERSCORE_RUN}`,
      limit: 10,
    });

    expect(found.map((profile) => profile.email)).toEqual([`ann_lee@${UNDERSCORE_RUN}.acme.test`]);
  });

  /** @scenario "an operator finds a user by email, name or id" */
  it("matches the address, the name or the id, case aside", async () => {
    const repository = PrismaUserRepository.create({ prisma: connection.client });

    const byAddress = await repository.searchProfiles({
      query: `DANA@${RUN.toUpperCase()}`,
      limit: 10,
    });
    expect(byAddress.map(({ id }) => id)).toEqual([danaId]);
    await expect(repository.searchProfiles({ query: danaId, limit: 10 })).resolves.toHaveLength(1);
    const byRun = await repository.searchProfiles({ query: RUN, limit: 10 });
    expect(byRun.map(({ email }) => email)).toEqual([
      `dana@${RUN}.acme.test`,
      `kay@${RUN}.other.test`,
    ]);
    await expect(repository.searchProfiles({ query: RUN, limit: 1 })).resolves.toHaveLength(1);
  });
});
