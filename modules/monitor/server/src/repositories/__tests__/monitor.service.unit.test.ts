/**
 * @vitest-environment node
 * The monitor service over the memory repository: the rules a write is subject
 * to, with no door and no database in the way.
 * @see specs/monitor-service.feature
 */
import { EvaluatorNotFoundError } from "@langwatch/evaluator-contract";
import {
  MonitorEvaluatorRequiredError,
  MonitorNotFoundError,
  type MonitorWithEvaluator,
} from "@langwatch/monitor-contract";
import { describe, expect, it } from "vitest";

import { FakeMonitorEvaluators } from "../../app/__tests__/monitor.fixture.ts";
import { MonitorService } from "../../services/monitor.service.ts";
import { MemoryMonitorRepository } from "../memory/memory.monitor.repository.ts";

const NOW = new Date("2026-08-24T00:00:00.000Z");

const stored: MonitorWithEvaluator = {
  id: "monitor_1",
  projectId: "project_1",
  experimentId: null,
  evaluatorId: "evaluator_1",
  checkType: "hallucination",
  name: "Hallucination",
  slug: "hallucination-1",
  executionMode: "ON_MESSAGE",
  enabled: true,
  preconditions: [],
  parameters: {},
  mappings: { mapping: {}, expansions: [] },
  sample: 1,
  level: "trace",
  threadIdleTimeout: null,
  createdAt: NOW,
  updatedAt: NOW,
  evaluator: null,
};

function harness(
  options: { seed?: readonly MonitorWithEvaluator[]; known?: readonly string[]; id?: string } = {},
) {
  const repository = MemoryMonitorRepository.create();
  for (const monitor of options.seed ?? []) repository.seed(monitor);
  const evaluators = new FakeMonitorEvaluators(options.known ?? ["evaluator_1"]);

  return {
    repository,
    evaluators,
    service: MonitorService.create({
      repository,
      evaluators,
      generateId: () => options.id ?? "monitor_test",
    }),
  };
}

const create = {
  projectId: "project_1",
  name: "Monitor",
  checkType: "hallucination",
  preconditions: [],
  parameters: {},
  mappings: {},
  sample: 1,
  executionMode: "ON_MESSAGE" as const,
};

const update = {
  id: "monitor_1",
  projectId: "project_1",
  name: "Monitor",
  checkType: "hallucination",
  preconditions: [],
  parameters: {},
  mappings: {},
  sample: 1,
  executionMode: "ON_MESSAGE" as const,
};

describe("MonitorService", () => {
  /** @scenario "Creating a monitor requires a project evaluator" */
  it("requires an evaluator on create", async () => {
    const { service } = harness();

    await expect(service.create(create)).rejects.toBeInstanceOf(MonitorEvaluatorRequiredError);
  });

  /** @scenario "Updating a legacy monitor may preserve its missing evaluator" */
  /** @scenario "Monitor mappings are canonicalised" */
  it("preserves an omitted evaluator and normalises mappings on update", async () => {
    const { service } = harness({ seed: [stored], known: [] });

    const updated = await service.update(update);

    expect(updated.mappings).toEqual({ mapping: {}, expansions: [] });
    expect(updated.evaluatorId).toBe("evaluator_1");
  });

  /** @scenario "Explicitly removing an evaluator is rejected" */
  it("rejects explicitly removing an evaluator", async () => {
    const { service } = harness({ seed: [stored] });

    await expect(service.update({ ...update, evaluatorId: null })).rejects.toBeInstanceOf(
      MonitorEvaluatorRequiredError,
    );
  });

  /** @scenario "Missing monitor reads throw" */
  it("throws for a missing monitor", async () => {
    const { service } = harness();

    await expect(service.getById({ id: "missing", projectId: "project_1" })).rejects.toBeInstanceOf(
      MonitorNotFoundError,
    );
  });

  /** @scenario "Runtime reads are project scoped" */
  it("reads enabled on-message monitors of one project only", async () => {
    const { service } = harness({
      seed: [stored, { ...stored, id: "monitor_2", projectId: "project_2", name: "Other" }],
    });

    await expect(service.listEnabledGuardrailMonitors({
      projectId: "project_1",
      evaluatorIds: ["evaluator_1"],
    })).resolves.toEqual([]);
    await expect(service.getAllForProject({ projectId: "project_2" })).resolves.toMatchObject([
      { id: "monitor_2" },
    ]);
  });

  /** @scenario "Replicating a monitor creates a disabled target monitor" */
  it("replicates a monitor disabled into the target project", async () => {
    const { service, repository } = harness({
      seed: [stored, { ...stored, id: "monitor_taken", projectId: "project_2" }],
      id: "monitor_replica",
    });

    const replica = await service.replicate({
      sourceMonitorId: "monitor_1",
      sourceProjectId: "project_1",
      targetProjectId: "project_2",
      evaluatorId: null,
    });

    expect(replica).toMatchObject({
      id: "monitor_replica",
      projectId: "project_2",
      evaluatorId: null,
      enabled: false,
      experimentId: null,
      name: "Hallucination (2)",
      slug: "hallucination-2-plica",
    });
    await expect(
      repository.findById({ id: "monitor_1", projectId: "project_1" }),
    ).resolves.toMatchObject({ name: "Hallucination", enabled: true });
  });

  describe("given an experiment being published as a monitor", () => {
    const published = {
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

    describe("when the wizard saves it", () => {
      it("stores it against the experiment it is published for", async () => {
        const { service, repository } = harness();

        const written = await service.upsertForExperiment(published);

        expect(written).toMatchObject({
          projectId: "project_1",
          experimentId: "experiment_1",
          slug: "answer-relevancy",
          id: "monitor_test",
        });
        await expect(repository.findAll({ projectId: "project_1" })).resolves.toHaveLength(1);
      });

      it("stores the preconditions and parameters as the wizard left them", async () => {
        const { service } = harness();

        const written = await service.upsertForExperiment(published);

        expect(written.preconditions).toEqual([
          { field: "input", rule: "contains", value: "hello" },
        ]);
        expect(written.parameters).toEqual({ model: "gpt-5-mini" });
      });

      it("asks no evaluator to vouch for the check the experiment names", async () => {
        const { service, evaluators } = harness({ known: [] });

        await expect(service.upsertForExperiment(published)).resolves.toBeDefined();
        expect(evaluators.archived).toEqual([]);
      });
    });

    describe("when the experiment never configured a trace mapping", () => {
      it("canonicalises it, because the empty shape crashes the evaluator read", async () => {
        const { service } = harness();

        const written = await service.upsertForExperiment({ ...published, mappings: {} });

        expect(written.mappings).toEqual({ mapping: {}, expansions: [] });
      });
    });

    describe("when the stored execution mode is not one this platform runs", () => {
      it("refuses the save rather than writing a monitor that never fires", async () => {
        const { service, repository } = harness();

        await expect(
          service.upsertForExperiment({ ...published, executionMode: "WHENEVER" }),
        ).rejects.toThrow();
        await expect(repository.findAll({ projectId: "project_1" })).resolves.toEqual([]);
      });
    });
  });

  // Ported from the REST family's Postgres integration test, which proved this
  // by posting an unknown evaluator id and reading back a 404. The rule is the
  // service's: a monitor may only name an evaluator its own project has.
  /** @scenario "Creating a monitor with an unknown evaluator is rejected" */
  it("refuses a create naming an evaluator the project does not have", async () => {
    const { service, repository } = harness({ known: [] });

    await expect(
      service.create({ ...create, evaluatorId: "evaluator_missing" }),
    ).rejects.toBeInstanceOf(EvaluatorNotFoundError);
    await expect(repository.findAll({ projectId: "project_1" })).resolves.toEqual([]);
  });
});
