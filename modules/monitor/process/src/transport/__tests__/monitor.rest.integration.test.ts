/**
 * @vitest-environment node
 * The `/api/monitors` family: the paths it answers at, the shapes it publishes
 * and the statuses its refusals carry.
 */
import type { MonitorWithEvaluator } from "@langwatch/monitor-contract";
import { describe, expect, it } from "vitest";

import { errorCodeOf, mountMonitorRest, TEST_PROJECT } from "./monitor-rest.harness.ts";

const NOW = new Date("2026-08-24T00:00:00.000Z");

const seeded: MonitorWithEvaluator = {
  id: "monitor-1",
  projectId: TEST_PROJECT.id,
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

const create = {
  name: "Toxicity Monitor",
  checkType: "langevals/llm_boolean",
  parameters: { model: "openai/gpt-5-mini" },
  mappings: {},
  evaluatorId: "evaluator-1",
};

describe("the monitors REST family", () => {
  describe("when the project's monitors are listed", () => {
    it("answers each one with its own platform link", async () => {
      const api = mountMonitorRest({ seed: [seeded] });

      const response = await api.get("/api/monitors");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual([
        {
          id: "monitor-1",
          name: "Toxicity Monitor",
          slug: "toxicity-monitor-tor-1",
          checkType: "langevals/llm_boolean",
          enabled: true,
          executionMode: "ON_MESSAGE",
          sample: 1,
          level: "trace",
          evaluatorId: "evaluator-1",
          preconditions: [],
          parameters: { model: "openai/gpt-5-mini" },
          mappings: { mapping: {}, expansions: [] },
          threadIdleTimeout: null,
          createdAt: "2026-08-24T00:00:00.000Z",
          updatedAt: "2026-08-24T00:00:00.000Z",
          platformUrl:
            "https://app.langwatch.test/project-one/online-evaluations?drawer.open=onlineEvaluation&drawer.monitorId=monitor-1",
        },
      ]);
    });

    it("answers at the dated namespace, at latest, and under /api/v1", async () => {
      const api = mountMonitorRest({ seed: [seeded] });

      for (const path of [
        "/api/monitors",
        "/api/monitors/2026-08-07",
        "/api/monitors/latest",
        "/api/v1/monitors",
        "/api/v1/monitors/2026-08-07",
        "/api/v1/monitors/latest",
      ]) {
        const response = await api.get(path);

        expect([path, response.status]).toEqual([path, 200]);
      }
    });
  });

  describe("when a create names an evaluator", () => {
    /** @scenario Creating a monitor with an evaluator succeeds */
    it("answers 201 with the evaluator still attached, in the credential's project", async () => {
      const api = mountMonitorRest();

      const response = await api.post("/api/monitors", create);

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        name: "Toxicity Monitor",
        evaluatorId: "evaluator-1",
      });
      await expect(api.repository.findAll({ projectId: TEST_PROJECT.id })).resolves.toHaveLength(1);
    });

    it("fills the defaults the wire contract promises for an unmentioned field", async () => {
      const api = mountMonitorRest();

      await api.post("/api/monitors", {
        name: "Bare",
        checkType: "langevals/llm_boolean",
        mappings: {},
        evaluatorId: "evaluator-1",
      });

      const [written] = await api.repository.findAll({ projectId: TEST_PROJECT.id });
      expect(written).toMatchObject({
        executionMode: "ON_MESSAGE",
        preconditions: [],
        parameters: {},
        sample: 1,
        level: "trace",
      });
    });
  });

  describe("when the application refuses a write", () => {
    /** @scenario Creating a monitor without an evaluator is rejected */
    it("answers with the refusal's own status and code, not a 500", async () => {
      const api = mountMonitorRest();

      const response = await api.post("/api/monitors", {
        name: "No evaluator",
        checkType: "langevals/llm_boolean",
        mappings: {},
      });

      expect(response.status).toBe(400);
      await expect(errorCodeOf(response)).resolves.toBe("monitor_evaluator_required");
    });

    /** @scenario Removing the evaluator from a monitor is rejected */
    it("carries the same refusal out of a partial update", async () => {
      const api = mountMonitorRest({ seed: [seeded] });

      const response = await api.patch("/api/monitors/monitor-1", {
        mappings: {},
        evaluatorId: null,
      });

      expect(response.status).toBe(400);
      await expect(errorCodeOf(response)).resolves.toBe("monitor_evaluator_required");
    });
  });

  describe("when a legacy monitor carries no evaluator", () => {
    /** @scenario Updating other fields of a legacy monitor without an evaluator still works */
    it("renames it and answers with a null evaluatorId", async () => {
      const api = mountMonitorRest({
        seed: [{ ...seeded, id: "monitor-legacy", evaluatorId: null }],
      });

      const response = await api.patch("/api/monitors/monitor-legacy", {
        mappings: {},
        name: "Legacy Check Renamed",
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        name: "Legacy Check Renamed",
        evaluatorId: null,
      });
    });
  });

  describe("when the project has no such monitor", () => {
    it("answers 404 on the read", async () => {
      const api = mountMonitorRest();

      const response = await api.get("/api/monitors/ghost");

      expect(response.status).toBe(404);
      await expect(errorCodeOf(response)).resolves.toBe("monitor_not_found");
    });

    it("answers 404 on a partial update, a toggle and a delete", async () => {
      const api = mountMonitorRest();

      const patched = await api.patch("/api/monitors/ghost", { mappings: {}, name: "Whatever" });
      expect(patched.status).toBe(404);

      const toggled = await api.post("/api/monitors/ghost/toggle", { enabled: true });
      expect(toggled.status).toBe(404);

      const removed = await api.delete("/api/monitors/ghost");
      expect(removed.status).toBe(404);
    });
  });

  describe("when a toggle or a delete lands", () => {
    it("answers the identifier and the new state", async () => {
      const api = mountMonitorRest({ seed: [seeded] });

      const toggled = await api.post("/api/monitors/monitor-1/toggle", { enabled: false });
      expect(toggled.status).toBe(200);
      await expect(toggled.json()).resolves.toEqual({ id: "monitor-1", enabled: false });
      await expect(
        api.repository.findById({ id: "monitor-1", projectId: TEST_PROJECT.id }),
      ).resolves.toMatchObject({ enabled: false });

      const removed = await api.delete("/api/monitors/monitor-1");
      expect(removed.status).toBe(200);
      await expect(removed.json()).resolves.toEqual({ id: "monitor-1", deleted: true });
    });
  });

  describe("when the request body does not match the schema", () => {
    it("refuses a create with no name before the application is touched", async () => {
      const api = mountMonitorRest();

      const response = await api.post("/api/monitors", {
        checkType: "langevals/llm_boolean",
        mappings: {},
      });

      expect(response.status).toBe(422);
      await expect(errorCodeOf(response)).resolves.toBe("validation_error");
      await expect(api.repository.findAll({ projectId: TEST_PROJECT.id })).resolves.toEqual([]);
    });

    it("refuses a sample outside the zero-to-one range", async () => {
      const api = mountMonitorRest();

      const response = await api.post("/api/monitors", { ...create, sample: 2 });

      expect(response.status).toBe(422);
      await expect(api.repository.findAll({ projectId: TEST_PROJECT.id })).resolves.toEqual([]);
    });
  });
});
