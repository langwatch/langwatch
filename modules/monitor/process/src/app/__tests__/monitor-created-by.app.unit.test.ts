/**
 * @vitest-environment node
 *
 * Who created and last changed a monitor, and the evaluator label a monitor runs.
 */
import { evaluatorSchema } from "@langwatch/evaluator-contract";
import type { MonitorWithEvaluator } from "@langwatch/monitor-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { MemoryMonitorRepository } from "../../repositories/memory/memory.monitor.repository.ts";
import {
  createMonitorTestApp,
  createMonitorTestRepositories,
  FakeMonitorEvaluators,
} from "./monitor.fixture.ts";

const NOW = new Date("2026-08-24T00:00:00.000Z");
const projectId = "project-1";

const evaluator = evaluatorSchema.parse({
  id: "evaluator-1",
  projectId,
  name: "Toxicity",
  slug: "toxicity",
  type: "evaluator",
  config: { evaluatorType: "langevals/toxicity", settings: { threshold: 3 } },
  workflowId: null,
  copiedFromEvaluatorId: null,
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
});

function monitorRow(overrides: Partial<MonitorWithEvaluator> = {}): MonitorWithEvaluator {
  return {
    id: "monitor-1",
    projectId,
    experimentId: null,
    evaluatorId: "evaluator-1",
    checkType: "langevals/toxicity",
    name: "Toxicity monitor",
    slug: "toxicity-monitor-1",
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
    evaluator,
    ...overrides,
  };
}

const users = createApiFixture<UserApi>({
  getProfiles: async ({ userIds }) =>
    [
      { id: "user_ada", name: "Ada", email: "ada@example.com" },
      { id: "user_grace", name: "Grace", email: "grace@example.com" },
    ].filter((person) => userIds.includes(person.id)) as never,
});

function harness(seed: MonitorWithEvaluator[] = []) {
  const repository = MemoryMonitorRepository.create({ seed });
  const evaluators = new FakeMonitorEvaluators(["evaluator-1"]);
  const app = createMonitorTestApp({
    repositories: createMonitorTestRepositories(repository),
    evaluators,
    users,
  });
  return { app, evaluators };
}

const createInput = {
  projectId,
  name: "Toxicity monitor",
  checkType: "langevals/toxicity",
  preconditions: [],
  parameters: {},
  sample: 1,
  executionMode: "ON_MESSAGE" as const,
  evaluatorId: "evaluator-1",
};

function thresholdOf(monitor: MonitorWithEvaluator): unknown {
  return (monitor.evaluator?.config as { settings?: { threshold?: unknown } } | null)?.settings
    ?.threshold;
}

describe("who created and last changed a monitor", () => {
  /** @scenario "Creating a monitor records its creator" */
  it("records the creating user as creator and last updater", async () => {
    const { app } = harness();
    const created = await app.create({ ...createInput, actorId: "user_ada" });

    const read = await app.getById({ id: created.id, projectId });
    expect([read.createdById, read.updatedById]).toEqual(["user_ada", "user_ada"]);
    expect(read.createdBy).toEqual({ id: "user_ada", name: "Ada" });
  });

  /** @scenario "Updating a monitor records the last updater" */
  it("keeps the creator and records the last updater", async () => {
    const { app } = harness();
    const created = await app.create({ ...createInput, actorId: "user_ada" });
    await app.patch({ id: created.id, projectId, changes: { sample: 0.5 }, actorId: "user_grace" });

    const read = await app.getById({ id: created.id, projectId });
    expect(read.createdBy).toEqual({ id: "user_ada", name: "Ada" });
    expect(read.updatedBy).toEqual({ id: "user_grace", name: "Grace" });
  });

  /** @scenario "Monitors created before creators were recorded show no creator" */
  it("reads a null creator for a monitor with none recorded", async () => {
    const { app } = harness([monitorRow()]);

    const [listed] = await app.list({ projectId });
    expect(listed!.createdBy).toBeNull();
  });
});

describe("a monitor pinned to an evaluator label", () => {
  /** @scenario "A monitor pinned to a label runs that evaluator version" */
  it("carries the labelled settings, and the latest without a label", async () => {
    const { app, evaluators } = harness([
      monitorRow({ evaluatorLabel: "production" }),
      monitorRow({ id: "monitor-2", slug: "toxicity-monitor-2" }),
    ]);
    evaluators.labelled["evaluator-1"] = {
      production: { evaluatorType: "langevals/toxicity", settings: { threshold: 1 } },
    };

    expect(thresholdOf(await app.getById({ id: "monitor-1", projectId }))).toBe(1);
    expect(thresholdOf(await app.getById({ id: "monitor-2", projectId }))).toBe(3);
  });

  /** @scenario "A monitor pinned to a label that was removed keeps running latest" */
  it("carries the latest settings when the label is gone", async () => {
    const { app } = harness([monitorRow({ evaluatorLabel: "staging" })]);

    expect(thresholdOf(await app.getById({ id: "monitor-1", projectId }))).toBe(3);
  });

  /** @scenario "A guardrail pinned to a label runs that evaluator version" */
  it("lists a labelled guardrail with the labelled settings, and an unlabelled one as stored", async () => {
    const guardrail = { executionMode: "AS_GUARDRAIL" as const, parameters: { threshold: 5 } };
    const { app, evaluators } = harness([
      monitorRow({ ...guardrail, evaluatorLabel: "production" }),
      monitorRow({ ...guardrail, id: "monitor-2", slug: "toxicity-monitor-2" }),
    ]);
    evaluators.labelled["evaluator-1"] = {
      production: { evaluatorType: "langevals/toxicity", settings: { threshold: 1 } },
    };

    const listed = await app.listEnabledGuardrailMonitors({
      projectId,
      evaluatorIds: ["evaluator-1"],
    });
    expect(listed).toEqual([
      expect.objectContaining({ id: "monitor-1", parameters: { threshold: 1 } }),
      expect.objectContaining({ id: "monitor-2", parameters: { threshold: 5 } }),
    ]);
  });
});
