/**
 * @see specs/suites/test-suite-membership-invariant.feature
 */
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";

import { PrismaScenarioRepository } from "../scenario.repository.ts";

const NOW = new Date("2026-01-01T00:00:00.000Z");

/** The row the create writes back, as the schema requires it. */
const scenarioRow = (overrides: Record<string, unknown> = {}) => ({
  id: "scenario_new",
  projectId: "project_1",
  name: "Refund flow",
  situation: "The customer asks for a refund",
  criteria: ["It offers the refund"],
  labels: [],
  parameters: null,
  simulatorModel: null,
  judgeModel: null,
  maxTurns: null,
  minTurns: null,
  testSuiteId: "test_suite_1",
  version: 1,
  lastUpdatedById: null,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

/**
 * A transaction that answers every read the write path makes, and records the
 * two calls the recompute is: what it asked for, and what it wrote back.
 */
function transactionDouble(members: Array<{ id: string }>) {
  const scenarioFindMany = vi.fn(async () => members);
  const suiteUpdate = vi.fn(async () => ({}));
  const executeRaw = vi.fn(async () => 0);
  const transaction = {
    $executeRaw: executeRaw,
    scenario: {
      create: vi.fn(async () => scenarioRow()),
      findMany: scenarioFindMany,
    },
    scenarioVersion: { create: vi.fn(async () => ({})) },
    simulationSuite: {
      findFirst: vi.fn(async () => ({
        id: "test_suite_1",
        projectId: "project_1",
        kind: "test_suite",
        archivedAt: null,
        scope: null,
      })),
      update: suiteUpdate,
    },
  };

  return {
    database: {
      $transaction: async (work: (tx: unknown) => Promise<unknown>) => await work(transaction),
    } as unknown as PrismaClient,
    scenarioFindMany,
    suiteUpdate,
    executeRaw,
  };
}

describe("given a test suite whose scenarios include archived ones", () => {
  describe("when membership is recomputed by a write to the test suite", () => {
    /** @scenario "Recomputing membership counts only active scenarios" */
    it("holds only the active scenarios on the test suite", async () => {
      const world = transactionDouble([{ id: "scenario_1" }, { id: "scenario_2" }]);

      await PrismaScenarioRepository.create(world.database).create({
        id: "scenario_new",
        projectId: "project_1",
        name: "Refund flow",
        situation: "The customer asks for a refund",
        criteria: ["It offers the refund"],
        labels: [],
        parameters: null,
        simulatorModel: null,
        judgeModel: null,
        maxTurns: null,
        minTurns: null,
        testSuiteId: "test_suite_1",
        actor: { label: "user", userId: "user_1" },
      });

      // Only the active members are read, so an archived scenario cannot come
      // back into the list a recompute writes.
      expect(world.scenarioFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: "project_1", testSuiteId: "test_suite_1", archivedAt: null },
        }),
      );
      expect(world.suiteUpdate).toHaveBeenCalledWith({
        where: { id: "test_suite_1", projectId: "project_1" },
        data: { scenarioIds: ["scenario_1", "scenario_2"] },
      });
      // The lock comes before the read that decides what to write, or a second
      // writer reads the list as it was and overwrites this one.
      expect(world.executeRaw.mock.invocationCallOrder[0]!).toBeLessThan(
        world.scenarioFindMany.mock.invocationCallOrder[0]!,
      );
    });
  });
});
