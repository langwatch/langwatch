/**
 * @vitest-environment node
 * @see enterprise/modules/governance/specs/security-lake-ingest.feature
 *
 * A source a service key adds has no user behind it: the real table takes it with no creator.
 */
import { randomBytes } from "node:crypto";

import { aesEncryption } from "@langwatch/process-stores";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGovernanceTestConnection } from "../../../app/__tests__/governance-database.fixture.ts";
import { PrismaIngestionSourceRepository } from "../prisma.ingestion-source.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("PrismaIngestionSourceRepository.create with no creator", () => {
  const connection = createGovernanceTestConnection(databaseUrl ?? "");
  const prisma = connection.client;
  const suffix = nanoid(8);
  const organizationId = `org-no-creator-${suffix}`;
  const repository = PrismaIngestionSourceRepository.create({
    database: prisma,
    cipher: aesEncryption(randomBytes(32)),
  });

  beforeAll(async () => {
    await prisma.organization.create({
      data: { id: organizationId, name: `No creator ${suffix}`, slug: `no-creator-${suffix}` },
    });
  });

  afterAll(async () => {
    await prisma.ingestionSource.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  });

  /** @scenario "A service key adds a Security Lake source with no user as its creator" */
  it("stores the source with a null creator", async () => {
    const source = await repository.create({
      organizationId,
      teamId: null,
      traceProjectId: null,
      sourceType: "security_lake",
      name: "ACME Security Lake",
      description: null,
      ingestSecretHash: "",
      parserConfig: {},
      pullSchedule: null,
      status: "awaiting_first_event",
      createdById: null,
      providerAccountId: null,
    });

    const stored = await prisma.ingestionSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(stored.createdById).toBeNull();
  });
});
