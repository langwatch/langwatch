/**
 * @vitest-environment node
 *
 * `ScenarioApp.queueSimulationRun` — the metadata envelope a queued run
 * carries.
 *
 * The envelope decides what the fold projection may copy into the runs store,
 * and, deliberately, what it may not: the resolved secret VALUES travel BESIDE
 * the metadata, never inside it, so only their names can ever be folded into a
 * stored run. That is a fact about what a stored run may contain, not a
 * transport detail, which is why the application assembles the envelope rather
 * than each door assembling its own.
 *
 * No tRPC here. `simulation-runner.api.unit.test.ts` covers what the run
 * procedure refuses before anything is queued; this covers what the queued
 * command is made of once it gets there.
 *
 * @see specs/scenarios/simulation-runner.feature
 */
import type {
  ScenarioExecutionService,
  ScenarioService,
  ScenarioTabRegistry,
  SimulationQueueRun,
  SimulationService,
} from "@langwatch/scenario-contract";
import type { UserService } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { ScenarioApp, type QueueSimulationRunInput } from "../src/app/scenario.app";

function harness() {
  const commands: SimulationQueueRun[] = [];

  // Queueing is the only run capability the envelope reaches.
  const simulations: Partial<SimulationService> = {
    queueRun: async (input) => {
      commands.push(input);
    },
  };

  const app = ScenarioApp.create({
    simulations: simulations as SimulationService,
    // Nothing below is reached: assembling the envelope reads only its
    // argument and the run capability. A reach for any of them throws on the
    // missing property, which is the loud failure we want.
    scenarios: {} as ScenarioService,
    scenarioExecution: {} as ScenarioExecutionService,
    scenarioTabs: {} as ScenarioTabRegistry,
    users: {} as UserService,
    broadcast: {
      getTenantEmitter: () => {
        throw new Error("the queue path subscribes to nothing");
      },
    },
  });

  const queue = (overrides: Partial<QueueSimulationRunInput> = {}) =>
    app.queueSimulationRun({
      projectId: "project-1",
      scenarioId: "scenario-1",
      scenarioRunId: "scenariorun-1",
      batchRunId: "batch-1",
      setId: "set-1",
      name: "Login flow",
      target: { type: "http", referenceId: "agent-1" },
      parameters: {},
      secretParameters: {},
      note: undefined,
      scenarioVersion: undefined,
      ...overrides,
    });

  const queued = (): SimulationQueueRun => {
    const command = commands[0];
    if (!command) throw new Error("nothing was queued");
    return command;
  };

  const metadata = (): Record<string, unknown> => queued().metadata ?? {};

  return { queue, queued, metadata };
}

describe("ScenarioApp.queueSimulationRun", () => {
  describe("given a run that resolved secret parameters", () => {
    const secretParameters = {
      OPENAI_API_KEY: "ciphertext-for-openai",
      SLACK_TOKEN: "ciphertext-for-slack",
    };

    it("records only the secret names on the metadata", async () => {
      const { queue, metadata } = harness();

      await queue({ secretParameters });

      expect(metadata().secretParameterNames).toEqual(["OPENAI_API_KEY", "SLACK_TOKEN"]);
    });

    // The fold projection copies the metadata into the runs store. A value
    // that reached the metadata would be readable from a stored run forever,
    // so this is the assertion the whole rule exists for.
    it("keeps every secret value out of the metadata", async () => {
      const { queue, metadata } = harness();

      await queue({ secretParameters });

      const serialized = JSON.stringify(metadata());
      expect(serialized).not.toContain("ciphertext-for-openai");
      expect(serialized).not.toContain("ciphertext-for-slack");
    });

    it("carries the values beside the metadata, on the command's own field", async () => {
      const { queue, queued } = harness();

      await queue({ secretParameters });

      expect(queued().secretParameters).toEqual(secretParameters);
    });
  });

  describe("given a run with no secret parameters", () => {
    it("sends no secret field at all rather than an empty one", async () => {
      const { queue, queued } = harness();

      await queue({ secretParameters: {} });

      expect(queued()).not.toHaveProperty("secretParameters");
    });

    it("records no secret names on the metadata", async () => {
      const { queue, metadata } = harness();

      await queue({ secretParameters: {} });

      expect(metadata()).not.toHaveProperty("secretParameterNames");
    });
  });

  describe("given a run pointed at a target", () => {
    it("records the target and its kind in the reserved namespace", async () => {
      const { queue, metadata } = harness();

      await queue({ target: { type: "workflow", referenceId: "workflow-9" } });

      expect(metadata().langwatch).toEqual({
        targetReferenceId: "workflow-9",
        targetType: "workflow",
      });
    });

    it("passes the same target through as the command's own field", async () => {
      const { queue, queued } = harness();

      await queue({ target: { type: "workflow", referenceId: "workflow-9" } });

      expect(queued().target).toEqual({ type: "workflow", referenceId: "workflow-9" });
    });
  });

  describe("given a run queued from a known scenario version", () => {
    it("stamps the version in the reserved namespace", async () => {
      const { queue, metadata } = harness();

      await queue({ scenarioVersion: 4 });

      expect(metadata().langwatch).toEqual({
        targetReferenceId: "agent-1",
        targetType: "http",
        scenarioVersion: 4,
      });
    });
  });

  describe("given a run whose scenario version is unknown", () => {
    it("omits the key rather than recording an empty version", async () => {
      const { queue, metadata } = harness();

      await queue({ scenarioVersion: undefined });

      expect(metadata().langwatch).not.toHaveProperty("scenarioVersion");
    });
  });

  describe("given a run carrying a note", () => {
    /** @scenario "The note is written under the top-level note key of the run metadata" */
    it("writes the note beside the reserved namespace, never inside it", async () => {
      const { queue, metadata } = harness();

      await queue({ note: "nightly regression" });

      expect(metadata().note).toBe("nightly regression");
      expect(metadata().langwatch).not.toHaveProperty("note");
    });

    it("drops a note of only spaces", async () => {
      const { queue, metadata } = harness();

      await queue({ note: "   " });

      expect(metadata()).not.toHaveProperty("note");
    });
  });

  describe("given a run carrying resolved parameters", () => {
    it("records them under their own key", async () => {
      const { queue, metadata } = harness();

      await queue({ parameters: { account_tier: "platinum", region: "eu-central" } });

      expect(metadata().parameters).toEqual({
        account_tier: "platinum",
        region: "eu-central",
      });
    });
  });

  describe("given a run carrying nothing but its target", () => {
    /** @scenario "A run queued without a note records metadata identical to before notes existed" */
    it("records only the reserved namespace", async () => {
      const { queue, metadata } = harness();

      await queue();

      expect(metadata()).toEqual({
        langwatch: { targetReferenceId: "agent-1", targetType: "http" },
      });
    });
  });

  describe("when the command is addressed", () => {
    it("names the project as the tenant and the set under its own field", async () => {
      const { queue, queued } = harness();

      await queue();

      expect(queued()).toMatchObject({
        tenantId: "project-1",
        scenarioId: "scenario-1",
        scenarioRunId: "scenariorun-1",
        batchRunId: "batch-1",
        scenarioSetId: "set-1",
        name: "Login flow",
      });
    });

    it("stamps the moment the run was queued", async () => {
      const before = Date.now();
      const { queue, queued } = harness();

      await queue();

      expect(queued().occurredAt).toBeGreaterThanOrEqual(before);
    });
  });
});
