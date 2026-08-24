import { describe, expect, it, vi } from "vitest";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import {
  MonitorEvaluatorRequiredError,
  MonitorNotFoundError,
  type MonitorCreateInput,
  type MonitorMappingState,
  type MonitorUpdateInput,
  type Monitor,
} from "@langwatch/monitor-contract";
import { MonitorService } from "../src/services/monitor.service";
import { MonitorRepository } from "../src/repositories/monitor.repository";

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
  async findAll() { return []; }
  async findEnabledOnMessage() { return []; }
  async tryFindById() { return this.value ? { ...this.value, evaluator: null } : null; }
  async findAllByIds() { return this.value ? [this.value] : []; }
  async setEnabled() {}
  async create(input: MonitorCreateInput & { id: string; slug: string; mappings: MonitorMappingState }) {
    this.value = { ...monitor, ...input };
    if (!this.value) throw new Error("missing fake monitor");
    return this.value;
  }
  async update(input: MonitorUpdateInput & { slug: string; mappings: MonitorMappingState }) {
    this.value = { ...monitor, ...input };
    if (!this.value) throw new Error("missing fake monitor");
    return this.value;
  }
  async delete() { this.value = null; }
  async isNameAvailable(input: { name: string }) { return input.name !== monitor.name; }
}

const evaluator = { getById: vi.fn(async () => ({})) } as unknown as Pick<EvaluatorService, "getById">;

describe("MonitorService", () => {
  it("requires an evaluator on create", async () => {
    const service = MonitorService.create({ repository: new FakeRepository(), evaluators: evaluator });
    await expect(service.create({
      projectId: "project_1", name: "Monitor", checkType: "hallucination",
      preconditions: {}, parameters: {}, mappings: {}, sample: 1,
      executionMode: "ON_MESSAGE",
    })).rejects.toBeInstanceOf(MonitorEvaluatorRequiredError);
  });

  it("preserves omitted evaluator and normalises mappings on update", async () => {
    const repository = new FakeRepository();
    const service = MonitorService.create({ repository, evaluators: evaluator });
    const updated = await service.update({
      id: "monitor_1", projectId: "project_1", name: "Monitor", checkType: "hallucination",
      preconditions: {}, parameters: {}, mappings: {}, sample: 1,
      executionMode: "ON_MESSAGE",
    });
    expect(updated.mappings).toEqual({ mapping: {}, expansions: [] });
    expect(evaluator.getById).not.toHaveBeenCalled();
  });

  it("rejects explicitly removing an evaluator", async () => {
    const service = MonitorService.create({ repository: new FakeRepository(), evaluators: evaluator });
    await expect(service.update({
      id: "monitor_1", projectId: "project_1", name: "Monitor", checkType: "hallucination",
      preconditions: {}, parameters: {}, mappings: {}, sample: 1,
      executionMode: "ON_MESSAGE", evaluatorId: null,
    })).rejects.toBeInstanceOf(MonitorEvaluatorRequiredError);
  });

  it("throws for a missing monitor", async () => {
    const repository = new FakeRepository();
    repository.value = null;
    const service = MonitorService.create({ repository, evaluators: evaluator });
    await expect(service.getById({ id: "missing", projectId: "project_1" })).rejects.toBeInstanceOf(MonitorNotFoundError);
  });
});
