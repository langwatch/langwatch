import { describe, expect, it, vi } from "vitest";
import { EvaluatorNotFoundError, EvaluatorService } from "@langwatch/evaluator-contract";
import {
  MonitorEvaluatorRequiredError,
  MonitorNotFoundError,
  type MonitorCreateInput,
  type MonitorMappingState,
  type MonitorUpdateInput,
  type Monitor,
} from "@langwatch/monitor-contract";
import { MonitorService } from "../../services/monitor.service";
import { MonitorRepository } from "../monitor.repository";

const monitor: Monitor = {
  id: "monitor_1",
  projectId: "project_1",
  experimentId: null,
  evaluatorId: "evaluator_1",
  checkType: "hallucination",
  name: "Hallucination",
  slug: "hallucination-1",
  executionMode: "ON_MESSAGE",
  enabled: true,
  preconditions: {},
  parameters: {},
  mappings: { mapping: {}, expansions: [] },
  sample: 1,
  level: "trace",
  threadIdleTimeout: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

class FakeRepository extends MonitorRepository {
  value: Monitor | null = monitor;
  async findAll() {
    return [];
  }
  async findEnabledOnMessage() {
    return [];
  }
  async listEnabledGuardrails() {
    return [];
  }
  async tryFindById() {
    return this.value ? { ...this.value, evaluator: null } : null;
  }
  async findAllByIds() {
    return this.value ? [this.value] : [];
  }
  async setEnabled() {}
  async create(
    input: MonitorCreateInput & {
      id: string;
      slug: string;
      mappings: MonitorMappingState;
    },
  ) {
    this.value = { ...monitor, ...input };
    if (!this.value) throw new Error("missing fake monitor");
    return this.value;
  }
  async createReplica(input: Monitor) {
    this.value = input;
    return input;
  }
  async update(input: MonitorUpdateInput & { slug: string; mappings: MonitorMappingState }) {
    this.value = { ...monitor, ...input };
    if (!this.value) throw new Error("missing fake monitor");
    return this.value;
  }
  async delete() {
    this.value = null;
  }
  async deleteForExperiment() {
    this.value = null;
  }
  experimentUpserts: Array<Parameters<MonitorRepository["upsertForExperiment"]>[0]> = [];
  async upsertForExperiment(input: Parameters<MonitorRepository["upsertForExperiment"]>[0]) {
    this.experimentUpserts.push(input);
    this.value = {
      ...monitor,
      id: input.id,
      projectId: input.projectId,
      experimentId: input.experimentId,
      name: input.name,
      slug: input.slug,
      checkType: input.checkType,
      executionMode: input.executionMode,
      enabled: input.enabled,
      sample: input.sample,
      mappings: input.mappings,
    };
    return this.value;
  }
  async isNameAvailable(input: { name: string }) {
    return input.name !== monitor.name;
  }
}

class FakeEvaluatorService extends EvaluatorService {
  async resolveForExecution(): Promise<never> {
    throw new Error("unused");
  }
  async executeCode(): Promise<never> {
    throw new Error("unused");
  }
  async executeNative(): Promise<never> {
    throw new Error("unused");
  }
  augmentResult(): never {
    throw new Error("unused");
  }
  getById = vi.fn<EvaluatorService["getById"]>();
  async tryGetById(): Promise<never> {
    throw new Error("unused");
  }
  async tryGetByIdWithFields(): Promise<never> {
    throw new Error("unused");
  }
  async getByIdWithFields(): Promise<never> {
    throw new Error("unused");
  }
  async tryGetBySlug(): Promise<never> {
    throw new Error("unused");
  }
  async tryGetByWorkflow(): Promise<never> {
    throw new Error("unused");
  }
  async getBySlug(): Promise<never> {
    throw new Error("unused");
  }
  async getAll(): Promise<never> {
    throw new Error("unused");
  }
  async getAllWithFields(): Promise<never> {
    throw new Error("unused");
  }
  async create(): Promise<never> {
    throw new Error("unused");
  }
  async createWithDefaults(): Promise<never> {
    throw new Error("unused");
  }
  async update(): Promise<never> {
    throw new Error("unused");
  }
  async archive(): Promise<never> {
    throw new Error("unused");
  }
  async getWorkflowFields(): Promise<never> {
    throw new Error("unused");
  }
  async getCopies(): Promise<never> {
    throw new Error("unused");
  }
  async pushToCopies(): Promise<never> {
    throw new Error("unused");
  }
  async syncFromSource(): Promise<never> {
    throw new Error("unused");
  }
  async getCopySource(): Promise<never> {
    throw new Error("unused");
  }
  async getHistory(): Promise<never> {
    throw new Error("unused");
  }
}

const evaluator = new FakeEvaluatorService();
const generateId = () => "monitor_test";

describe("MonitorService", () => {
  it("requires an evaluator on create", async () => {
    const service = MonitorService.create({
      repository: new FakeRepository(),
      evaluators: evaluator,
      generateId,
    });
    await expect(
      service.create({
        projectId: "project_1",
        name: "Monitor",
        checkType: "hallucination",
        preconditions: {},
        parameters: {},
        mappings: {},
        sample: 1,
        executionMode: "ON_MESSAGE",
      }),
    ).rejects.toBeInstanceOf(MonitorEvaluatorRequiredError);
  });

  it("preserves omitted evaluator and normalises mappings on update", async () => {
    const repository = new FakeRepository();
    const service = MonitorService.create({ repository, evaluators: evaluator, generateId });
    const updated = await service.update({
      id: "monitor_1",
      projectId: "project_1",
      name: "Monitor",
      checkType: "hallucination",
      preconditions: {},
      parameters: {},
      mappings: {},
      sample: 1,
      executionMode: "ON_MESSAGE",
    });
    expect(updated.mappings).toEqual({ mapping: {}, expansions: [] });
    expect(evaluator.getById).not.toHaveBeenCalled();
  });

  it("rejects explicitly removing an evaluator", async () => {
    const service = MonitorService.create({
      repository: new FakeRepository(),
      evaluators: evaluator,
      generateId,
    });
    await expect(
      service.update({
        id: "monitor_1",
        projectId: "project_1",
        name: "Monitor",
        checkType: "hallucination",
        preconditions: {},
        parameters: {},
        mappings: {},
        sample: 1,
        executionMode: "ON_MESSAGE",
        evaluatorId: null,
      }),
    ).rejects.toBeInstanceOf(MonitorEvaluatorRequiredError);
  });

  it("throws for a missing monitor", async () => {
    const repository = new FakeRepository();
    repository.value = null;
    const service = MonitorService.create({ repository, evaluators: evaluator, generateId });
    await expect(service.getById({ id: "missing", projectId: "project_1" })).rejects.toBeInstanceOf(
      MonitorNotFoundError,
    );
  });

  it("replicates a monitor disabled into the target project", async () => {
    const repository = new FakeRepository();
    const service = MonitorService.create({
      repository,
      evaluators: evaluator,
      generateId: () => "monitor_replica",
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
    });
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
      it("hands the store the experiment it is published for", async () => {
        const repository = new FakeRepository();
        const service = MonitorService.create({ repository, evaluators: evaluator, generateId });

        await service.upsertForExperiment(published);

        expect(repository.experimentUpserts[0]).toMatchObject({
          projectId: "project_1",
          experimentId: "experiment_1",
          slug: "answer-relevancy",
        });
      });

      it("supplies the id the row would need were it new", async () => {
        const repository = new FakeRepository();
        const service = MonitorService.create({ repository, evaluators: evaluator, generateId });

        await service.upsertForExperiment(published);

        expect(repository.experimentUpserts[0]?.id).toBe("monitor_test");
      });

      it("stores the preconditions and parameters as the wizard left them", async () => {
        const repository = new FakeRepository();
        const service = MonitorService.create({ repository, evaluators: evaluator, generateId });

        await service.upsertForExperiment(published);

        expect(repository.experimentUpserts[0]?.preconditions).toEqual([
          { field: "input", rule: "contains", value: "hello" },
        ]);
        expect(repository.experimentUpserts[0]?.parameters).toEqual({ model: "gpt-5-mini" });
      });

      it("asks no evaluator to vouch for the check the experiment names", async () => {
        const repository = new FakeRepository();
        const evaluators = new FakeEvaluatorService();
        const service = MonitorService.create({ repository, evaluators, generateId });

        await service.upsertForExperiment(published);

        expect(evaluators.getById).not.toHaveBeenCalled();
      });
    });

    describe("when the experiment never configured a trace mapping", () => {
      it("canonicalises it, because the empty shape crashes the evaluator read", async () => {
        const repository = new FakeRepository();
        const service = MonitorService.create({ repository, evaluators: evaluator, generateId });

        await service.upsertForExperiment({ ...published, mappings: {} });

        expect(repository.experimentUpserts[0]?.mappings).toEqual({
          mapping: {},
          expansions: [],
        });
      });
    });

    describe("when the stored execution mode is not one this platform runs", () => {
      it("refuses the save rather than writing a monitor that never fires", async () => {
        const repository = new FakeRepository();
        const service = MonitorService.create({ repository, evaluators: evaluator, generateId });

        await expect(
          service.upsertForExperiment({ ...published, executionMode: "WHENEVER" }),
        ).rejects.toThrow();
        expect(repository.experimentUpserts).toHaveLength(0);
      });
    });
  });

  // Ported from the REST family's Postgres integration test, which proved this
  // by posting an unknown evaluator id and reading back a 404. The rule is the
  // service's: a monitor may only name an evaluator its own project has.
  /** @scenario Creating a monitor with an unknown evaluator is rejected */
  it("refuses a create naming an evaluator the project does not have", async () => {
    const repository = new FakeRepository();
    repository.value = null;
    const evaluators = new FakeEvaluatorService();
    evaluators.getById.mockRejectedValue(new EvaluatorNotFoundError("evaluator_missing"));
    const service = MonitorService.create({ repository, evaluators, generateId });

    await expect(
      service.create({
        projectId: "project_1",
        name: "Monitor",
        checkType: "hallucination",
        preconditions: {},
        parameters: {},
        mappings: {},
        sample: 1,
        executionMode: "ON_MESSAGE",
        evaluatorId: "evaluator_missing",
      }),
    ).rejects.toMatchObject({ code: "evaluator_not_found" });
    expect(repository.value).toBeNull();
  });
});
