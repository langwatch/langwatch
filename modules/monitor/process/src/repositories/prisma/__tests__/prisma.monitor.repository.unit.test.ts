/**
 * Tests the experiment-published monitor upsert: keyed by experimentId to
 * replace on republish.
 */

import type { Monitor } from "@langwatch/monitor-contract";
import { describe, expect, it } from "vitest";

import type { MonitorRepository } from "../../monitor.repository.ts";
import { PrismaMonitorRepository } from "../prisma.monitor.repository.ts";

type ExperimentUpsert = Parameters<MonitorRepository["upsertForExperiment"]>[0];

const STORED: Monitor = {
  id: "monitor_stored",
  projectId: "project_1",
  experimentId: "experiment_1",
  evaluatorId: null,
  checkType: "ragas/answer_relevancy",
  name: "Answer relevancy",
  slug: "answer-relevancy",
  executionMode: "ON_MESSAGE",
  enabled: true,
  preconditions: [{ field: "input", rule: "contains", value: "hello" }],
  parameters: { model: "gpt-5-mini" },
  mappings: { mapping: {}, expansions: [] },
  sample: 1,
  level: "trace",
  threadIdleTimeout: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

const INPUT: ExperimentUpsert = {
  id: "monitor_generated",
  projectId: "project_1",
  experimentId: "experiment_1",
  name: "Answer relevancy",
  checkType: "ragas/answer_relevancy",
  slug: "answer-relevancy",
  preconditions: [{ field: "input", rule: "contains", value: "hello" }],
  parameters: { model: "gpt-5-mini" },
  mappings: { mapping: {}, expansions: [] },
  sample: 0.5,
  enabled: true,
  executionMode: "ON_MESSAGE",
};

function repositoryWith(row: unknown = STORED) {
  const calls: Record<string, unknown>[] = [];
  const database = {
    monitor: {
      async upsert(args: Record<string, unknown>) {
        calls.push(args);
        return row;
      },
    },
  };

  return { calls, repository: PrismaMonitorRepository.create({ prisma: database as never }) };
}

describe("PrismaMonitorRepository", () => {
  describe("given an experiment being published as a monitor", () => {
    describe("when the monitor is written", () => {
      it("keys the upsert on the experiment inside its own project", async () => {
        const { repository, calls } = repositoryWith();

        await repository.upsertForExperiment(INPUT);

        expect(calls[0]?.where).toEqual({
          experimentId: "experiment_1",
          projectId: "project_1",
        });
      });

      it("carries the same configuration whether the row is created or replaced", async () => {
        const { repository, calls } = repositoryWith();

        await repository.upsertForExperiment(INPUT);

        const configuration = {
          name: "Answer relevancy",
          checkType: "ragas/answer_relevancy",
          slug: "answer-relevancy",
          preconditions: [{ field: "input", rule: "contains", value: "hello" }],
          parameters: { model: "gpt-5-mini" },
          mappings: { mapping: {}, expansions: [] },
          sample: 0.5,
          enabled: true,
          executionMode: "ON_MESSAGE",
        };
        expect(calls[0]?.update).toEqual(configuration);
        expect(calls[0]?.create).toEqual({
          ...configuration,
          id: "monitor_generated",
          projectId: "project_1",
          experimentId: "experiment_1",
        });
      });

      it("leaves the id off the replace branch so a republish keeps the row it has", async () => {
        const { repository, calls } = repositoryWith();

        await repository.upsertForExperiment(INPUT);

        expect(calls[0]?.update).not.toHaveProperty("id");
      });

      it("returns the stored monitor rather than the values it was handed", async () => {
        const { repository } = repositoryWith();

        await expect(repository.upsertForExperiment(INPUT)).resolves.toEqual(STORED);
      });
    });
  });
});
