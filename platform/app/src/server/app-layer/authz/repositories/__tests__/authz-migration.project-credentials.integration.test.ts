/**
 * @vitest-environment node
 *
 * The authz migration grants each project credential admin over its project.
 * A project key is stored as a hash once the sweep has run, so the
 * "has a credential" predicate must hold for a row with no plaintext left.
 * Against a real database because the predicate is SQL: `apiKey <> ''` is
 * false for NULL, which is the regression this pins.
 *
 * Requires: PostgreSQL database (Prisma)
 *
 * @see specs/api-keys/project-key-hashed-storage.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { mintProjectApiKey } from "~/server/api-key/project-api-key";
import { prisma } from "~/server/db";
import { generateApiKey } from "~/server/utils/apiKeyGenerator";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";

import { PrismaAuthzMigrationRepository } from "../authz-migration.prisma.repository";

wireDefaultTestApp();

describe("PrismaAuthzMigrationRepository.findProjectCredentialFacts", () => {
  const ns = `authz-credential-facts-${nanoid(8)}`;
  const repository = new PrismaAuthzMigrationRepository(prisma);
  let organizationId: string;
  let plaintextProjectId: string;
  let hashedProjectId: string;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Credential Facts Org", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;
    const team = await prisma.team.create({
      data: { name: "Team", slug: `--test-team-${ns}`, organizationId },
    });
    const base = {
      teamId: team.id,
      language: "en",
      framework: "test",
    };
    plaintextProjectId = (
      await prisma.project.create({
        data: {
          ...base,
          name: "Plaintext",
          slug: `--test-project-${ns}-plaintext`,
          apiKey: generateApiKey(),
        },
      })
    ).id;
    hashedProjectId = (
      await prisma.project.create({
        data: {
          ...base,
          name: "Hashed",
          slug: `--test-project-${ns}-hashed`,
          ...mintProjectApiKey().columns,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.project
      .deleteMany({ where: { slug: { startsWith: `--test-project-${ns}` } } })
      .catch(() => {});
    await prisma.team
      .deleteMany({ where: { slug: { startsWith: `--test-team-${ns}` } } })
      .catch(() => {});
    await prisma.organization
      .deleteMany({ where: { slug: { startsWith: `--test-org-${ns}` } } })
      .catch(() => {});
  });

  describe("when one project key is in plaintext and another is a hash only", () => {
    it("returns a credential fact for both projects", async () => {
      const facts = await repository.findProjectCredentialFacts({
        organizationId,
      });

      expect(facts.map((fact) => fact.projectId).sort()).toEqual(
        [plaintextProjectId, hashedProjectId].sort(),
      );
    });
  });
});
