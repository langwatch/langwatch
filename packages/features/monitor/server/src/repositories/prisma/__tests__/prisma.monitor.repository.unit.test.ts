/**
 * How the monitor an experiment is published as gets written.
 *
 * "Save as monitor" is an upsert keyed by the experiment rather than by the
 * monitor: `Monitor.experimentId` is unique, so a second press has to reach the
 * row the first press created instead of adding another beside it. Both
 * branches carry the identical configuration — a field present on one and not
 * the other is a field that silently drifts on republish — and the generated id
 * belongs to the create branch alone.
 *
 * The client is a fake that records what it was asked, since the claim is about
 * the statement issued rather than about what Postgres does with it.
 */

import { describe, expect, it } from "vitest";
import type { Monitor } from "@langwatch/monitor-contract";
import type { MonitorRepository } from "../../monitor.repository";
import { PrismaMonitorRepository } from "../prisma.monitor.repository";

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
  const calls: Array<Record<string, unknown>> = [];
  const database = {
    monitor: {
      async upsert(args: Record<string, unknown>) {
        calls.push(args);
        return row;
      },
    },
  };

  return { calls, repository: PrismaMonitorRepository.create(database as never) };
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
