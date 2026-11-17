/**
 * An operator's organization search against Postgres: name, slug or id, case aside, with the
 * member count that tells two organizations of the same name apart.
 * @vitest-environment node
 * @see modules/ops/specs/feature-flag-target-search.feature
 */
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaOrganizationRepository } from "../prisma.organization.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaOrganizationRepository operator rows", () => {
  const tag = nanoid(8).toLowerCase();
  const name = `Operator Search ${tag}`;
  const first = { id: `org-opsearch-a-${tag}`, slug: `opsearch-a-${tag}` };
  const second = { id: `org-opsearch-b-${tag}`, slug: `opsearch-b-${tag}` };
  const userId = `user-opsearch-${tag}`;

  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:operator-rows"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repository = PrismaOrganizationRepository.create({
    database: prisma,
    cipher: { encrypt: (value: string) => value, decrypt: (value: string) => value },
  });

  beforeAll(async () => {
    await prisma.organization.create({
      data: { ...first, name, createdAt: new Date("2025-01-01T00:00:00Z") },
    });
    await prisma.organization.create({
      data: { ...second, name, createdAt: new Date("2026-01-01T00:00:00Z") },
    });
    await prisma.user.create({ data: { id: userId, email: `${userId}@acme.test` } });
    await prisma.organizationUser.create({
      data: { organizationId: first.id, userId, role: "ADMIN" },
    });
  });

  afterAll(async () => {
    await prisma.organizationUser.deleteMany({ where: { organizationId: first.id, userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.organization.deleteMany({ where: { id: { in: [first.id, second.id] } } });
    await prisma.$disconnect();
  });

  /** @scenario "an operator finds an organization by name, slug or id" */
  it("finds both organizations by their shared name, oldest first, with member counts", async () => {
    const rows = await repository.findOperatorRows({ query: name.toUpperCase(), limit: 10 });

    expect(rows.map((row) => [row.id, row.slug, row.memberCount])).toEqual([
      [first.id, first.slug, 1],
      [second.id, second.slug, 0],
    ]);
    expect(rows[0]?.createdAt.toString()).toBe("2025-01-01T00:00:00Z");
  });

  it("finds one organization by its slug or its id, and respects the limit", async () => {
    await expect(repository.findOperatorRows({ query: second.slug, limit: 10 })).resolves.toEqual([
      expect.objectContaining({ id: second.id }),
    ]);
    await expect(repository.findOperatorRows({ query: first.id, limit: 10 })).resolves.toEqual([
      expect.objectContaining({ id: first.id }),
    ]);
    await expect(repository.findOperatorRows({ query: name, limit: 1 })).resolves.toHaveLength(1);
  });

  /** @scenario "stored rule targets render with their names" */
  it("reads the named ids and leaves out an id with no organization", async () => {
    const rows = await repository.findOperatorRows({
      organizationIds: [second.id, `org-missing-${tag}`],
    });

    expect(rows.map((row) => row.id)).toEqual([second.id]);
  });
});
