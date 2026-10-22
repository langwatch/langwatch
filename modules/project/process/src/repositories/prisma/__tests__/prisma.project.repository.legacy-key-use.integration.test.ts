/**
 * @vitest-environment node
 * A legacy key's last use lands on the project's own row, over real Postgres.
 * @see modules/api-key/specs/request-credential-type.feature
 */
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
  type PrismaConnection,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createTestLogger } from "@langwatch/test-harness";
import { Temporal } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaProjectRepository } from "../prisma.project.repository.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("PrismaProjectRepository legacy key use over Postgres", () => {
  const ns = `project-legacy-use-${nanoid(8)}`;
  const connection: PrismaConnection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createTestLogger().logger,
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const repository = PrismaProjectRepository.create({ prisma });
  const ids = { organization: "", team: "", project: "" };

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `Org ${ns}`, slug: `org-${ns}` },
    });
    ids.organization = organization.id;
    const team = await prisma.team.create({
      data: { name: `Team ${ns}`, slug: `team-${ns}`, organizationId: organization.id },
    });
    ids.team = team.id;
    const project = await prisma.project.create({
      data: {
        teamId: team.id,
        language: "python",
        framework: "openai",
        name: `App ${ns}`,
        slug: `app-${ns}`,
        apiKey: `key-app-${ns}`,
      },
    });
    ids.project = project.id;
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: ids.project } });
    await prisma.team.deleteMany({ where: { id: ids.team } });
    await prisma.organization.deleteMany({ where: { id: ids.organization } });
    await prisma.$disconnect();
  });

  /** @scenario "The stamp lands on the project's row" */
  it("writes the stamp time to legacyApiKeyLastUsedAt", async () => {
    const at = Temporal.Instant.from("2026-10-22T12:00:00Z");

    await repository.markLegacyApiKeyUsed({ projectId: ids.project, at });

    const row = await prisma.project.findUniqueOrThrow({
      where: { id: ids.project },
      select: { legacyApiKeyLastUsedAt: true },
    });
    expect(row.legacyApiKeyLastUsedAt?.toISOString()).toBe("2026-10-22T12:00:00.000Z");
  });
});
