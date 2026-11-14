/**
 * The docs playground switch on the organization row (ADR-185, amendment of 2026-11-13), against
 * Postgres: on by default for an organization, off for one that does not exist.
 * @vitest-environment node
 * @see modules/api-key/specs/docs-session-keys.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { Temporal, toDate } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaOrganizationRepository } from "../prisma.organization.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaOrganizationRepository docs playground policy", () => {
  const organizationId = `org-docs-playground-${nanoid(8)}`;

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:docs-playground"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repository = PrismaOrganizationRepository.create({
    database: prisma,
    cipher: { encrypt: (value: string) => value, decrypt: (value: string) => value },
  });

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: organizationId, name: organizationId, slug: organizationId },
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it("reads a new organization as on, the column's default, never turned off", async () => {
    await expect(repository.getDocsPlaygroundPolicy({ organizationId })).resolves.toEqual({
      docsPlaygroundSessionsEnabled: true,
      docsPlaygroundSessionsDisabledAt: null,
    });
  });

  it("reads an organization that does not exist as off", async () => {
    await expect(
      repository.getDocsPlaygroundPolicy({ organizationId: `${organizationId}-missing` }),
    ).resolves.toEqual({
      docsPlaygroundSessionsEnabled: false,
      docsPlaygroundSessionsDisabledAt: null,
    });
  });

  /** @scenario "Turning the playground session off records when, in the same write" */
  it("stores the switch turned off with its time, and keeps that time once it is on again", async () => {
    const offAt = Temporal.Instant.from("2026-11-14T10:00:00.000Z");
    await repository.saveDocsPlaygroundPolicy({
      organizationId,
      docsPlaygroundSessionsEnabled: false,
      changedAt: offAt,
    });
    await expect(repository.getDocsPlaygroundPolicy({ organizationId })).resolves.toEqual({
      docsPlaygroundSessionsEnabled: false,
      docsPlaygroundSessionsDisabledAt: toDate(offAt),
    });

    await repository.saveDocsPlaygroundPolicy({
      organizationId,
      docsPlaygroundSessionsEnabled: true,
      changedAt: offAt.add({ minutes: 1 }),
    });
    await expect(repository.getDocsPlaygroundPolicy({ organizationId })).resolves.toEqual({
      docsPlaygroundSessionsEnabled: true,
      docsPlaygroundSessionsDisabledAt: toDate(offAt),
    });
  });
});
