/**
 * @vitest-environment node
 * The Scenario aggregate's contract, stated once and run against the memory
 * twin always, the Postgres one when `LANGWATCH_TEST_DATABASE_URL` is named.
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { nowInstant, toDate } from "@langwatch/time";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { MemoryScenarioRepository } from "../memory/memory.scenario.repository.ts";
import { PrismaScenarioRepository } from "../prisma/scenario.repository.ts";
import type { ScenarioRepository } from "../scenario.repository.ts";

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

      await expect(repository.findById({ id, projectId: PROJECT_ID })).resolves.toMatchObject({
        id,
        name: "Refund a duplicate charge",
      });

      const archivedAt = nowInstant();
      await repository.archive({ id, projectId: PROJECT_ID, archivedAt });

      await expect(repository.findById({ id, projectId: PROJECT_ID })).rejects.toMatchObject({
        code: "scenario_not_found",
      });
      await expect(
        repository.tryFindByIdIncludingArchived({ id, projectId: PROJECT_ID }),
      ).resolves.toMatchObject({ id, archivedAt: toDate(archivedAt) });
    });
  });

  describe("when a test suite declares fields and evaluators", () => {
    /** @scenario "A test suite declares fields and reads them back" */
    it("reads back the fields and evaluators it was created and updated with", async () => {
      const repository = backend.repository();
      const fields = [{ identifier: "golden_sql", type: "text" as const }];
      const evaluators = [
        {
          id: "att_1",
          evaluatorId: "eval_1",
          required: true,
          mappings: {
            expected_output: {
              type: "source" as const,
              sourceId: "scenario" as const,
              path: ["fields", "golden_sql"],
            },
          },
        },
      ];
      const created = await repository.createTestSuite({
        id: `suite_${randomUUID()}`,
        projectId: PROJECT_ID,
        name: `Case lookups ${randomUUID().slice(0, 8)}`,
        fields,
        evaluators,
      });

      expect(created.fields).toEqual(fields);
      expect(created.evaluators).toEqual(evaluators);

      const updatedFields = [
        { identifier: "golden_sql", type: "text" as const },
        { identifier: "table_schema", type: "text" as const },
      ];
      const updated = await repository.updateTestSuite({
        testSuiteId: created.id,
        projectId: PROJECT_ID,
        fields: updatedFields,
      });

      expect(updated.fields).toEqual(updatedFields);
      expect(updated.evaluators).toEqual(evaluators);
      await expect(
        repository.findTestSuite({ testSuiteId: created.id, projectId: PROJECT_ID }),
      ).resolves.toMatchObject({ fields: updatedFields, evaluators });
    });
  });

  describe("when a scenario carries a value per suite field", () => {
    /** @scenario "A scenario carries a value per suite field" */
    it("reads back the same field values it was created with", async () => {
      const repository = backend.repository();
      const testSuite = await repository.createTestSuite({
        id: `suite_${randomUUID()}`,
        projectId: PROJECT_ID,
        name: `Case lookups ${randomUUID().slice(0, 8)}`,
        fields: [{ identifier: "golden_sql", type: "text" as const }],
      });
      const id = `scenario_${randomUUID()}`;

      const created = await repository.create({
        id,
        projectId: PROJECT_ID,
        name: "Look up a customer's last order",
        situation: "An analyst asks for the customer's last order",
        criteria: ["The agent answers with the right row"],
        labels: [],
        testSuiteId: testSuite.id,
        lastUpdatedById: null,
        actor: { userId: null, label: "api" },
        fields: { golden_sql: "SELECT 1" },
      });

      expect(created.fields).toEqual({ golden_sql: "SELECT 1" });
      await expect(repository.findById({ id, projectId: PROJECT_ID })).resolves.toMatchObject({
        fields: { golden_sql: "SELECT 1" },
      });

      const updated = await repository.update({
        id,
        projectId: PROJECT_ID,
        actor: { userId: null, label: "api" },
        fields: { golden_sql: "SELECT 2" },
      });

      expect(updated.fields).toEqual({ golden_sql: "SELECT 2" });
      await expect(repository.findById({ id, projectId: PROJECT_ID })).resolves.toMatchObject({
        fields: { golden_sql: "SELECT 2" },
      });
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

      await expect(repository.findTestSuites({ projectId: PROJECT_ID })).resolves.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: testSuite.id })]),
      );
      await expect(
        repository.findTestSuites({ projectId: "another-project" }),
      ).resolves.not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: testSuite.id })]),
      );
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
  ? PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("scenario-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
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
    await connection?.closeOnce();
  });

  contractCases({ repository: tracked });
});
