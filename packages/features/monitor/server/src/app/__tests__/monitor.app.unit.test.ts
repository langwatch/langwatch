/**
 * @vitest-environment node
 *
 * The monitor application: the rules that moved off the two doors onto it.
 *
 * Four of them, and three were written twice before:
 *
 *   - what an unmentioned field on a partial update means. The REST family
 *     spelled the merge out for itself and the wizard spelled it out again,
 *     and the two copies had already begun to disagree;
 *   - the read-then-refuse pair a toggle and a delete perform, so a door
 *     answers "no such monitor" rather than reporting a write nobody made;
 *   - whether a check can run at all, refused by a code both doors render;
 *   - standing in the project a monitor is copied FROM, which the declared
 *     check on the procedure cannot cover.
 *
 * Over the memory repository. Nothing here speaks HTTP or tRPC.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  MonitorNotFoundError,
  type MonitorPatchInput,
  type MonitorWithEvaluator,
} from "@langwatch/monitor-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { MemoryMonitorRepository } from "../../repositories/memory/memory.monitor.repository.ts";
import {
  createMonitorTestApp,
  createMonitorTestRepositories,
  FakeMonitorEvaluators,
  FakeMonitorReplication,
} from "./monitor.fixture.ts";

const NOW = new Date("2026-08-24T00:00:00.000Z");

const existing: MonitorWithEvaluator = {
  id: "monitor-1",
  projectId: "project-1",
  experimentId: null,
  evaluatorId: "evaluator-1",
  checkType: "langevals/llm_boolean",
  name: "Toxicity Monitor",
  slug: "toxicity-monitor-tor-1",
  executionMode: "ON_MESSAGE",
  enabled: true,
  preconditions: [{ field: "trace.input", rule: "contains", value: "hello" }],
  parameters: { model: "openai/gpt-5-mini" },
  mappings: { mapping: { input: "trace.input" }, expansions: [] },
  sample: 0.5,
  level: "trace",
  threadIdleTimeout: 900,
  createdAt: NOW,
  updatedAt: NOW,
  evaluator: null,
};

/** The app over a repository already holding {@link existing}. */
function harness(
  overrides: Parameters<typeof createMonitorTestApp>[0] = {},
  seeded: MonitorWithEvaluator = existing,
) {
  const repository = MemoryMonitorRepository.create();
  repository.seed(seeded);
  const app = createMonitorTestApp({
    repositories: createMonitorTestRepositories(repository),
    evaluators: new FakeMonitorEvaluators(["evaluator-1", "evaluator-2"]),
    ...overrides,
  });

  return { app, repository };
}

async function patchWith(changes: MonitorPatchInput["changes"]) {
  const { app } = harness();

  return app.patch({ id: "monitor-1", projectId: "project-1", changes });
}

describe("MonitorApp", () => {
  describe("when a partial update mentions one field", () => {
    it("keeps every field the caller did not mention", async () => {
      const updated = await patchWith({ name: "Renamed" });

      expect(updated).toMatchObject({
        id: "monitor-1",
        projectId: "project-1",
        name: "Renamed",
        checkType: "langevals/llm_boolean",
        executionMode: "ON_MESSAGE",
        preconditions: [{ field: "trace.input", rule: "contains", value: "hello" }],
        parameters: { model: "openai/gpt-5-mini" },
        mappings: { mapping: { input: "trace.input" }, expansions: [] },
        sample: 0.5,
        level: "trace",
        threadIdleTimeout: 900,
      });
    });

    it("replaces only what it did mention", async () => {
      const updated = await patchWith({ sample: 0.1, level: "thread" });

      expect(updated).toMatchObject({ sample: 0.1, level: "thread", name: "Toxicity Monitor" });
    });
  });

  describe("when a partial update sends an explicit null", () => {
    it("clears the thread idle timeout rather than keeping the old one", async () => {
      await expect(patchWith({ threadIdleTimeout: null })).resolves.toMatchObject({
        threadIdleTimeout: null,
      });
    });

    it("refuses an evaluator removal, because a monitor needs one", async () => {
      await expect(patchWith({ evaluatorId: null })).rejects.toMatchObject({
        code: "monitor_evaluator_required",
      });
    });
  });

  describe("when a partial update mentions neither the enabled flag nor the evaluator", () => {
    it("leaves both as they were", async () => {
      const updated = await patchWith({ name: "Renamed" });

      expect(updated.enabled).toBe(true);
      expect(updated.evaluatorId).toBe("evaluator-1");
    });
  });

  describe("when the monitor's stored settings no longer parse", () => {
    it("stores an empty settings object rather than failing every later edit", async () => {
      const { app } = harness({}, { ...existing, parameters: "not-an-object" });

      const updated = await app.patch({
        id: "monitor-1",
        projectId: "project-1",
        changes: { name: "Renamed" },
      });

      expect(updated.parameters).toEqual({});
    });
  });

  describe("when the project has no such monitor", () => {
    it("refuses a partial update by name and writes nothing", async () => {
      const { app, repository } = harness();

      await expect(
        app.patch({ id: "ghost", projectId: "project-1", changes: { name: "Renamed" } }),
      ).rejects.toBeInstanceOf(MonitorNotFoundError);
      await expect(
        repository.findById({ id: "monitor-1", projectId: "project-1" }),
      ).resolves.toMatchObject({ name: "Toxicity Monitor" });
    });

    it("refuses a toggle by name and never toggles", async () => {
      const { app, repository } = harness();

      await expect(
        app.toggle({ id: "ghost", projectId: "project-1", enabled: false }),
      ).rejects.toMatchObject({ code: "monitor_not_found" });
      await expect(
        repository.findById({ id: "monitor-1", projectId: "project-1" }),
      ).resolves.toMatchObject({ enabled: true });
    });

    it("refuses a delete by name and never deletes", async () => {
      const { app, repository } = harness();

      await expect(app.delete({ id: "ghost", projectId: "project-1" })).rejects.toMatchObject({
        code: "monitor_not_found",
      });
      await expect(repository.findAll({ projectId: "project-1" })).resolves.toHaveLength(1);
    });
  });

  describe("when the project does have the monitor", () => {
    it("toggles it and reports the write happened", async () => {
      const { app, repository } = harness();

      await expect(
        app.toggle({ id: "monitor-1", projectId: "project-1", enabled: false }),
      ).resolves.toEqual({ success: true });
      await expect(
        repository.findById({ id: "monitor-1", projectId: "project-1" }),
      ).resolves.toMatchObject({ enabled: false });
    });

    it("deletes it and reports the write happened", async () => {
      const { app, repository } = harness();

      await expect(app.delete({ id: "monitor-1", projectId: "project-1" })).resolves.toEqual({
        success: true,
      });
      await expect(repository.findAll({ projectId: "project-1" })).resolves.toEqual([]);
    });
  });

  describe("when a check names something that cannot run", () => {
    it("names the check type as the reason", async () => {
      const { app } = harness();

      await expect(
        app.assertCheckRunnable({ checkType: "langevals/not_a_thing", parameters: {} }),
      ).rejects.toMatchObject({ code: "monitor_check_type_unknown" });
    });

    it("names the settings when they do not match the evaluator's schema", async () => {
      const { app } = harness();

      await expect(
        app.assertCheckRunnable({ checkType: "langevals/llm_boolean", parameters: { model: 42 } }),
      ).rejects.toMatchObject({ code: "monitor_check_settings_invalid" });
    });
  });

  describe("when a check carries its settings elsewhere", () => {
    it("accepts a workflow, code or custom evaluator on its type alone", async () => {
      const { app } = harness();

      await expect(
        app.assertCheckRunnable({ checkType: "workflow", parameters: undefined }),
      ).resolves.toBeUndefined();
      await expect(
        app.assertCheckRunnable({ checkType: "code/my-check", parameters: undefined }),
      ).resolves.toBeUndefined();
      await expect(
        app.assertCheckRunnable({ checkType: "custom/my-check", parameters: undefined }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a monitor is copied into another project", () => {
    const copy = {
      monitorId: "monitor-1",
      sourceProjectId: "project-1",
      targetProjectId: "project-2",
      actor: { id: "user-1" },
    };

    it("refuses when the caller cannot manage evaluations in the source project", async () => {
      const hasProjectPermission = vi.fn(async () => false);
      const { app } = harness({
        permissions: createApiFixture<AuthzApi>({ hasProjectPermission }),
      });

      await expect(app.copy(copy)).rejects.toMatchObject({
        code: "monitor_source_project_forbidden",
      });
      expect(hasProjectPermission).toHaveBeenCalledWith({
        userId: "user-1",
        projectId: "project-1",
        permission: "evaluations:manage",
      });
    });

    it("copies the evaluator first and points the replica at the copy, disabled", async () => {
      const replication = new FakeMonitorReplication({
        id: "evaluator-copied",
        workflowId: "workflow-copied",
      });
      const { app } = harness({
        replication,
        evaluators: new FakeMonitorEvaluators(["evaluator-1", "evaluator-copied"]),
        generateId: () => "monitor_replica",
      });

      const replica = await app.copy(copy);

      expect(replication.copies).toEqual([
        {
          evaluatorId: "evaluator-1",
          sourceProjectId: "project-1",
          targetProjectId: "project-2",
        },
      ]);
      expect(replica).toMatchObject({
        id: "monitor_replica",
        projectId: "project-2",
        evaluatorId: "evaluator-copied",
        enabled: false,
        experimentId: null,
      });
    });

    it("rolls the copied evaluator and its workflow back when the replica cannot be written", async () => {
      const replication = new FakeMonitorReplication({
        id: "evaluator-copied",
        workflowId: "workflow-copied",
      });
      // The copied evaluator is not one the target project holds, so writing
      // the replica refuses and everything this copy created is undone.
      const evaluators = new FakeMonitorEvaluators(["evaluator-1"]);
      const { app } = harness({ replication, evaluators });

      await expect(app.copy(copy)).rejects.toMatchObject({ code: "evaluator_not_found" });
      expect(evaluators.archived).toEqual([
        { id: "evaluator-copied", projectId: "project-2" },
      ]);
      expect(replication.deletedWorkflows).toEqual([
        { workflowId: "workflow-copied", projectId: "project-2" },
      ]);
    });
  });

  describe("when the seven-day trend is read", () => {
    const trend = { projectId: "project-1", actor: { id: "user-1" } };

    it("refuses a reader without analytics standing", async () => {
      const hasProjectPermission = vi.fn(
        async (input: { permission: string }) => input.permission !== "analytics:view",
      );
      const { app } = harness({
        permissions: createApiFixture<AuthzApi>({ hasProjectPermission }),
      });

      await expect(app.performanceForProject(trend)).rejects.toMatchObject({
        code: "project_permission_denied",
      });
    });

    it("answers nothing at all for a project with no monitors", async () => {
      const app = createMonitorTestApp();

      await expect(
        app.performanceForProject({ projectId: "empty-project", actor: { id: "user-1" } }),
      ).resolves.toEqual([]);
    });
  });
});
