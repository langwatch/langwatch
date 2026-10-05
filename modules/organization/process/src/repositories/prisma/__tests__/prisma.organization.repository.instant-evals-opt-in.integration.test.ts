/**
 * The organization's Instant Evals consent against Postgres: the first click
 * is the one kept, because the condition sits on the row the update locks.
 * @vitest-environment node
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { Temporal } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaOrganizationRepository } from "../prisma.organization.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaOrganizationRepository Instant Evals opt-in", () => {
  const namespace = `instant-evals-opt-in-${nanoid(8)}`;
  const organizationId = `${namespace}-organization`;
  const firstUserId = `${namespace}-first`;
  const laterUserId = `${namespace}-later`;
  const first = Temporal.Instant.from("2026-10-01T10:00:00Z");
  const later = Temporal.Instant.from("2026-10-02T10:00:00Z");

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:instant-evals-opt-in"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repository = PrismaOrganizationRepository.create(prisma);

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: organizationId, name: namespace, slug: namespace },
    });
    for (const id of [firstUserId, laterUserId]) {
      await prisma.user.create({ data: { id, email: `${id}@example.com`, name: id } });
    }
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.user.deleteMany({ where: { id: { in: [firstUserId, laterUserId] } } });
    await prisma.$disconnect();
  });

  describe("when a second member throws the switch later", () => {
    /** @scenario "A second click against the database keeps the first record" */
    it("keeps the first member's moment and member", async () => {
      expect(await repository.isInstantEvalsOptedIn({ organizationId })).toBe(false);

      await repository.recordInstantEvalsOptIn({ organizationId, userId: firstUserId, at: first });
      await repository.recordInstantEvalsOptIn({ organizationId, userId: laterUserId, at: later });

      const row = await prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { instantEvalsEnabledAt: true, instantEvalsEnabledByUserId: true },
      });
      expect(row.instantEvalsEnabledAt?.toISOString()).toBe("2026-10-01T10:00:00.000Z");
      expect(row.instantEvalsEnabledByUserId).toBe(firstUserId);
      expect(await repository.isInstantEvalsOptedIn({ organizationId })).toBe(true);
    });
  });
});
