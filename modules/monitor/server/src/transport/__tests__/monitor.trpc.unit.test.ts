/**
 * @vitest-environment node
 * The `monitors.*` procedures over the real runtime and the real application:
 * the names the browser calls, the standing each one needs, and the refusals
 * that reach the wire.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import { createTrpcRuntime } from "@langwatch/api/trpc";
import type { MonitorWithEvaluator } from "@langwatch/monitor-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

import {
  createMonitorTestApp,
  createMonitorTestRepositories,
  FakeMonitorEvaluators,
  FakeMonitorPerformance,
  FakeMonitorReplication,
} from "../../app/__tests__/monitor.fixture.ts";
import { MemoryMonitorRepository } from "../../repositories/memory/memory.monitor.repository.ts";
import { monitorTrpcTransport } from "../monitor.trpc.ts";
import { monitorTrpcTestPorts, type MonitorTrpcTestContext } from "./monitor.trpc.harness.ts";

const PROJECT_ID = "project-1";
const NOW = new Date("2026-08-24T00:00:00.000Z");

const seeded: MonitorWithEvaluator = {
  id: "monitor-1",
  projectId: PROJECT_ID,
  experimentId: null,
  evaluatorId: "evaluator-1",
  checkType: "langevals/llm_boolean",
  name: "Toxicity Monitor",
  slug: "toxicity-monitor-tor-1",
  executionMode: "ON_MESSAGE",
  enabled: true,
  preconditions: [],
  parameters: { model: "openai/gpt-5-mini" },
  mappings: { mapping: {}, expansions: [] },
  sample: 1,
  level: "trace",
  threadIdleTimeout: null,
  createdAt: NOW,
  updatedAt: NOW,
  evaluator: null,
};

function mount(
  options: {
    permits?: (permission: string) => boolean;
    seed?: readonly MonitorWithEvaluator[];
    performance?: FakeMonitorPerformance;
    replication?: FakeMonitorReplication;
    evaluators?: FakeMonitorEvaluators;
    hasProjectPermission?: (input: { permission: string }) => Promise<boolean>;
  } = {},
) {
  const repository = MemoryMonitorRepository.create();
  for (const monitor of options.seed ?? []) repository.seed(monitor);

  const performance = options.performance ?? new FakeMonitorPerformance();
  const replication =
    options.replication ?? new FakeMonitorReplication({ id: "evaluator-2", workflowId: null });
  const evaluators = options.evaluators ?? new FakeMonitorEvaluators(["evaluator-1"]);

  const app = createMonitorTestApp({
    repositories: createMonitorTestRepositories(repository),
    evaluators,
    performance,
    replication,
    permissions: createApiFixture<AuthzApi>({
      hasProjectPermission: options.hasProjectPermission ?? (async () => true),
    }),
    generateId: () => "monitor_new",
  });

  const trpc = initTRPC.context<MonitorTrpcTestContext>().create();
  const router = createTrpcRuntime<MonitorTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    ports: monitorTrpcTestPorts(options.permits ?? (() => true)),
  }).mount(monitorTrpcTransport, () => app);

  return {
    router,
    caller: router.createCaller({ actor: { id: "user-1" } }),
    repository,
    performance,
    replication,
    evaluators,
  };
}

const createInput = {
  projectId: PROJECT_ID,
  name: "Toxicity Monitor",
  checkType: "langevals/llm_boolean",
  preconditions: [],
  settings: { model: "openai/gpt-5-mini" },
  sample: 1,
  executionMode: "ON_MESSAGE" as const,
  evaluatorId: "evaluator-1",
};

describe("the monitors tRPC namespace", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the clients call", () => {
      const { router } = mount();

      expect(Object.keys(router._def.procedures).sort()).toEqual([
        "copy",
        "create",
        "delete",
        "getAllForProject",
        "getById",
        "getPerformanceForProject",
        "isNameAvailable",
        "toggle",
        "update",
      ]);
    });
  });

  describe("when a monitor names an evaluator we cannot run", () => {
    it("refuses the create before anything is written", async () => {
      const { caller, repository } = mount();

      await expect(
        caller.create({ ...createInput, checkType: "langevals/not_a_thing" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(repository.findAll({ projectId: PROJECT_ID })).resolves.toEqual([]);
    });

    it("accepts a workflow evaluator, whose settings live elsewhere", async () => {
      const { caller, repository } = mount();

      await expect(
        caller.create({ ...createInput, checkType: "workflow", settings: {} }),
      ).resolves.toMatchObject({ checkType: "workflow" });
      await expect(repository.findAll({ projectId: PROJECT_ID })).resolves.toHaveLength(1);
    });
  });

  describe("when the monitor does not exist", () => {
    it("answers NOT_FOUND on the read", async () => {
      const { caller } = mount();

      await expect(caller.getById({ id: "ghost", projectId: PROJECT_ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("when the caller lacks the declared permission", () => {
    it("refuses the write before the application is reached", async () => {
      const { caller, repository } = mount({
        permits: (permission) => permission !== "evaluations:create",
      });

      await expect(caller.create(createInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(repository.findAll({ projectId: PROJECT_ID })).resolves.toEqual([]);
    });
  });

  describe("when copying a monitor out of a project the caller cannot manage", () => {
    it("refuses before the source monitor is read", async () => {
      const { caller, replication } = mount({
        seed: [seeded],
        hasProjectPermission: async () => false,
      });

      await expect(
        caller.copy({
          monitorId: "monitor-1",
          projectId: "target",
          sourceProjectId: PROJECT_ID,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(replication.copies).toEqual([]);
    });
  });

  describe("when replicating the monitor fails after its evaluator was copied", () => {
    it("rolls the copied evaluator and its workflow back", async () => {
      const replication = new FakeMonitorReplication({
        id: "evaluator-2",
        workflowId: "workflow-2",
      });
      // The copy is not an evaluator the target project holds, so the replica
      // is refused and everything this copy created is undone.
      const evaluators = new FakeMonitorEvaluators(["evaluator-1"]);
      const { caller } = mount({ seed: [seeded], replication, evaluators });

      await expect(
        caller.copy({
          monitorId: "monitor-1",
          projectId: "target",
          sourceProjectId: PROJECT_ID,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      expect(evaluators.archived).toEqual([{ id: "evaluator-2", projectId: "target" }]);
      expect(replication.deletedWorkflows).toEqual([
        { workflowId: "workflow-2", projectId: "target" },
      ]);
    });
  });

  describe("when the trend is read", () => {
    it("answers with no rows rather than querying evaluations for an empty project", async () => {
      const { caller, performance } = mount();

      await expect(
        caller.getPerformanceForProject({ projectId: PROJECT_ID }),
      ).resolves.toEqual([]);
      expect(performance.queries).toEqual([]);
    });

    it("compares against the window the process resolves", async () => {
      const { caller, performance } = mount({ seed: [seeded] });

      await caller.getPerformanceForProject({ projectId: PROJECT_ID, timeZone: "Europe/Berlin" });

      expect(performance.queries[0]).toMatchObject({
        tenantId: PROJECT_ID,
        monitors: [{ id: "monitor-1" }],
        timeZone: "Europe/Berlin",
      });
      const query = performance.queries[0]!;
      expect(query.previousStartMs).toBe(query.currentStartMs - (query.endMs - query.currentStartMs));
    });

    it("refuses a reader who may see evaluations but not analytics", async () => {
      const { caller } = mount({
        seed: [seeded],
        permits: (permission) => permission !== "analytics:view",
      });

      await expect(
        caller.getPerformanceForProject({ projectId: PROJECT_ID }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
