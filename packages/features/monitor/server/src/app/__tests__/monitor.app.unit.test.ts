/**
 * @vitest-environment node
 *
 * The monitor application: the rules that moved off the two doors onto it.
 *
 * Three of them, and each was written twice before:
 *
 *   - what an unmentioned field on a partial update means. The REST family
 *     spelled the merge out for itself and the wizard spelled it out again,
 *     and the two copies had already begun to disagree;
 *   - the read-then-404 pair a toggle and a delete perform, so a door renders
 *     "no such monitor" rather than reporting a write nobody made;
 *   - whether a check can run at all, returned as a decision so each door can
 *     refuse in its own words without owning the rule.
 *
 * The services are stubbed. Nothing here speaks HTTP or tRPC.
 */
import type { EvaluationService } from "@langwatch/evaluation-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { Monitor, MonitorService, MonitorWithEvaluator } from "@langwatch/monitor-contract";
import { describe, expect, it, vi } from "vitest";
import { MonitorApp, type MonitorPatch } from "../monitor.app";

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

function harness({
  monitors = {},
  evaluations = {},
  evaluators = {},
}: {
  monitors?: Record<string, unknown>;
  evaluations?: Record<string, unknown>;
  evaluators?: Record<string, unknown>;
} = {}) {
  const monitorService = {
    getAllForProject: vi.fn(async () => [existing]),
    tryGetMonitorById: vi.fn(async () => existing),
    getById: vi.fn(async () => existing),
    update: vi.fn(async (input: unknown) => input as Monitor),
    toggle: vi.fn(async () => ({ success: true as const })),
    delete: vi.fn(async () => ({ success: true as const })),
    replicate: vi.fn(async () => existing as Monitor),
    ...monitors,
  } as unknown as MonitorService;

  const evaluationService = {
    getMonitorPerformance: vi.fn(async () => []),
    ...evaluations,
  } as unknown as EvaluationService;

  const evaluatorService = {
    archive: vi.fn(async () => undefined),
    ...evaluators,
  } as unknown as EvaluatorService;

  return {
    monitors: monitorService,
    evaluations: evaluationService,
    evaluators: evaluatorService,
    app: MonitorApp.create({
      monitors: monitorService,
      evaluations: evaluationService,
      evaluators: evaluatorService,
    }),
  };
}

/** The single argument the update was called with, for reading fields back. */
function updateInput(monitors: MonitorService): Record<string, unknown> {
  const update = monitors.update as unknown as { mock: { calls: unknown[][] } };
  return update.mock.calls[0]?.[0] as Record<string, unknown>;
}

const patchWith = async (changes: MonitorPatch) => {
  const { app, monitors } = harness();
  const result = await app.patch({ id: "monitor-1", projectId: "project-1", changes });
  return { result, monitors, sent: updateInput(monitors) };
};

describe("MonitorApp", () => {
  describe("when a partial update mentions one field", () => {
    it("keeps every field the caller did not mention", async () => {
      const { sent } = await patchWith({ name: "Renamed" });

      expect(sent).toMatchObject({
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
      const { sent } = await patchWith({ sample: 0.1, level: "thread" });

      expect(sent).toMatchObject({
        sample: 0.1,
        level: "thread",
        name: "Toxicity Monitor",
      });
    });
  });

  describe("when a partial update sends an explicit null", () => {
    it("clears the thread idle timeout rather than keeping the old one", async () => {
      const { sent } = await patchWith({ threadIdleTimeout: null });

      expect(sent.threadIdleTimeout).toBeNull();
    });

    it("clears the mappings rather than keeping the old ones", async () => {
      const { sent } = await patchWith({ mappings: null });

      expect(sent.mappings).toBeNull();
    });

    it("carries an evaluator removal through, so the service can refuse it", async () => {
      const { sent } = await patchWith({ evaluatorId: null });

      expect(sent.evaluatorId).toBeNull();
    });
  });

  describe("when a partial update mentions neither the enabled flag nor the evaluator", () => {
    it("leaves both unset, so the update touches neither", async () => {
      const { sent } = await patchWith({ name: "Renamed" });

      expect(sent.enabled).toBeUndefined();
      expect(sent.evaluatorId).toBeUndefined();
    });
  });

  describe("when the monitor's stored settings no longer parse", () => {
    it("sends an empty settings object rather than failing every later edit", async () => {
      const { app, monitors } = harness({
        monitors: {
          tryGetMonitorById: vi.fn(async () => ({
            ...existing,
            parameters: "not-an-object",
          })),
        },
      });

      await app.patch({ id: "monitor-1", projectId: "project-1", changes: { name: "Renamed" } });

      expect(updateInput(monitors).parameters).toEqual({});
    });
  });

  describe("when the project has no such monitor", () => {
    it("answers null from a partial update and writes nothing", async () => {
      const { app, monitors } = harness({
        monitors: { tryGetMonitorById: vi.fn(async () => null) },
      });

      await expect(
        app.patch({ id: "ghost", projectId: "project-1", changes: { name: "Renamed" } }),
      ).resolves.toBeNull();
      expect(monitors.update).not.toHaveBeenCalled();
    });

    it("answers false from a toggle and never toggles", async () => {
      const { app, monitors } = harness({
        monitors: { tryGetMonitorById: vi.fn(async () => null) },
      });

      await expect(
        app.toggleExisting({ id: "ghost", projectId: "project-1", enabled: true }),
      ).resolves.toBe(false);
      expect(monitors.toggle).not.toHaveBeenCalled();
    });

    it("answers false from a delete and never deletes", async () => {
      const { app, monitors } = harness({
        monitors: { tryGetMonitorById: vi.fn(async () => null) },
      });

      await expect(app.deleteExisting({ id: "ghost", projectId: "project-1" })).resolves.toBe(
        false,
      );
      expect(monitors.delete).not.toHaveBeenCalled();
    });
  });

  describe("when the project does have the monitor", () => {
    it("toggles it and reports the write happened", async () => {
      const { app, monitors } = harness();

      await expect(
        app.toggleExisting({ id: "monitor-1", projectId: "project-1", enabled: false }),
      ).resolves.toBe(true);
      expect(monitors.toggle).toHaveBeenCalledWith({
        id: "monitor-1",
        projectId: "project-1",
        enabled: false,
      });
    });

    it("deletes it and reports the write happened", async () => {
      const { app, monitors } = harness();

      await expect(app.deleteExisting({ id: "monitor-1", projectId: "project-1" })).resolves.toBe(
        true,
      );
      expect(monitors.delete).toHaveBeenCalledWith({ id: "monitor-1", projectId: "project-1" });
    });
  });

  describe("when a check names something that cannot run", () => {
    it("names the check type as the reason", () => {
      const { app } = harness();

      expect(app.checkFailure({ checkType: "langevals/not_a_thing", parameters: {} })).toEqual({
        reason: "unknown_check_type",
      });
    });

    it("names the settings when they do not match the evaluator's schema", () => {
      const { app } = harness();

      const failure = app.checkFailure({
        checkType: "langevals/llm_boolean",
        parameters: { model: 42 },
      });

      expect(failure?.reason).toBe("invalid_settings");
    });
  });

  describe("when a check carries its settings elsewhere", () => {
    it("accepts a workflow, code or custom evaluator on its type alone", () => {
      const { app } = harness();

      expect(app.checkFailure({ checkType: "workflow", parameters: undefined })).toBeNull();
      expect(app.checkFailure({ checkType: "code/my-check", parameters: undefined })).toBeNull();
      expect(app.checkFailure({ checkType: "custom/my-check", parameters: undefined })).toBeNull();
    });
  });
});
