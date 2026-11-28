/**
 * The organization's acceptance of the PII redaction model's price against Postgres: the first
 * admin's is the one kept, because the condition sits on the row the update locks.
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

describe.skipIf(!DB_URL)("PrismaOrganizationRepository PII redaction model acceptance", () => {
  const namespace = `pii-redaction-model-acceptance-${nanoid(8)}`;
  const organizationId = `${namespace}-organization`;
  const firstUserId = `${namespace}-first`;
  const laterUserId = `${namespace}-later`;
  const first = Temporal.Instant.from("2026-11-26T10:00:00Z");
  const later = Temporal.Instant.from("2026-11-27T10:00:00Z");

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:pii-redaction-model-acceptance"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repository = PrismaOrganizationRepository.create({
    database: prisma,
    cipher: { encrypt: (value: string) => value, decrypt: (value: string) => value },
  });

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

  describe("when a second admin accepts the price later", () => {
    /** @scenario "The acceptance is the organization's own record, kept once" */
    it("keeps the first admin's moment and id", async () => {
      expect(await repository.isPiiRedactionModelAccepted({ organizationId })).toBe(false);

      await repository.recordPiiRedactionModelAcceptance({
        organizationId,
        userId: firstUserId,
        at: first,
      });
      await repository.recordPiiRedactionModelAcceptance({
        organizationId,
        userId: laterUserId,
        at: later,
      });

      const row = await prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { piiRedactionModelAcceptedAt: true, piiRedactionModelAcceptedByUserId: true },
      });
      expect(row.piiRedactionModelAcceptedAt?.toISOString()).toBe("2026-11-26T10:00:00.000Z");
      expect(row.piiRedactionModelAcceptedByUserId).toBe(firstUserId);
      expect(await repository.isPiiRedactionModelAccepted({ organizationId })).toBe(true);
    });
  });
});
