/**
 * @vitest-environment node
 * The Scenario aggregate's contract, stated once and run against the memory
 * twin always, the Postgres one when `LANGWATCH_TEST_DATABASE_URL` is named.
 */
import { randomUUID } from "node:crypto";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { ScenarioRepository } from "../scenario.repository.ts";
import { MemoryScenarioRepository } from "../memory/memory.scenario.repository.ts";
import { PrismaScenarioRepository } from "../prisma/scenario.repository.ts";

const PROJECT_ID = "project-scenario-contract";

function contractCases(backend: { repository: () => ScenarioRepository }): void {
  describe("when a scenario is filed", () => {
    it("reads back what was created, and not once archived", async () => {
      const repository = backend.repository();
      const id = `scenario_${randomUUID()}`;
      await repository.create({
        id,
        projectId: PROJECT_ID,
        name: "Refund a duplicate charge",
        situation: "The customer was billed twice for the same order.",
        criteria: ["Offers a refund", "Apologises"],
        labels: [],
        lastUpdatedById: null,
        actor: { userId: null, label: "api" },
      });

      await expect(
        repository.tryFindById({ id, projectId: PROJECT_ID }),
      ).resolves.toMatchObject({ id, name: "Refund a duplicate charge" });

      const archivedAt = new Date();
      await repository.tryArchive({ id, projectId: PROJECT_ID, archivedAt });

      await expect(repository.tryFindById({ id, projectId: PROJECT_ID })).resolves.toBeNull();
      await expect(
        repository.tryFindByIdIncludingArchived({ id, projectId: PROJECT_ID }),
      ).resolves.toMatchObject({ id, archivedAt });
    });
  });

  describe("when a test suite files scenarios", () => {
    it("lists only the ones this project owns", async () => {
      const repository = backend.repository();
      const testSuite = await repository.createTestSuite({
        id: `suite_${randomUUID()}`,
        projectId: PROJECT_ID,
        name: `Onboarding ${randomUUID().slice(0, 8)}`,
      });

      await expect(
        repository.findTestSuites({ projectId: PROJECT_ID }),
      ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: testSuite.id })]));
      await expect(
        repository.findTestSuites({ projectId: "another-project" }),
      ).resolves.not.toEqual(expect.arrayContaining([expect.objectContaining({ id: testSuite.id })]));
    });
  });
}

describe("given the memory Scenario repository", () => {
  let repository: ScenarioRepository;

  beforeEach(() => {
    repository = MemoryScenarioRepository.create();
  });

  contractCases({ repository: () => repository });
});

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: PrismaTenancyGuardService.create() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");

  return connection.client as PrismaClient;
}

describe.skipIf(!databaseUrl)("given the Postgres Scenario repository", () => {
  const written: string[] = [];

  function tracked(): ScenarioRepository {
    return PrismaScenarioRepository.create(database());
  }

  afterAll(async () => {
    await database().scenario.deleteMany({ where: { id: { in: written } } });
    await connection?.disconnect();
  });

  contractCases({ repository: tracked });
});
