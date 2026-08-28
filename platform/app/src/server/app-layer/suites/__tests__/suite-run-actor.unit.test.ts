/**
 * @vitest-environment node
 *
 * Where the actor of a suite run is written, and what a run with no actor
 * records: the queued command is the only place the stamp happens, so this
 * reads it straight off the command the service dispatches.
 *
 * @see specs/scenarios/run-actor-on-runs.feature
 */

import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";
import type { QueueRunCommandData } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/commands";
import type { RunActor } from "~/server/scenarios/run-actor";
import { NullSuiteRunReadRepository } from "../repositories/suite-run.repository";
import { SuiteRunService } from "../suite-run.service";

/** Starts a run and returns the queued command it dispatched. */
async function queuedCommandFor(
  actor?: RunActor,
): Promise<QueueRunCommandData> {
  const queued: QueueRunCommandData[] = [];
  const service = new SuiteRunService(new NullSuiteRunReadRepository(), {
    startSuiteRun: async () => {},
    queueSimulationRun: async (data) => {
      queued.push(data);
    },
  });

  const scenarioId = `scenario-${nanoid()}`;
  await service.startRun({
    suiteId: `suite-${nanoid()}`,
    projectId: `project-${nanoid()}`,
    activeScenarioIds: [scenarioId],
    scenarioNameMap: new Map([[scenarioId, "Refund flow"]]),
    scenarioVersionMap: new Map([[scenarioId, 4]]),
    activeTargets: [{ type: "http", referenceId: "agent-1" }],
    repeatCount: 1,
    skippedArchived: { scenarios: [], targets: [] },
    idempotencyKey: `idem-${nanoid()}`,
    ...(actor && { actor }),
  });

  const command = queued[0];
  if (!command) throw new Error("startRun dispatched no queued command");
  return command;
}

describe("the actor stamp on a queued suite run", () => {
  describe("when the caller names a person", () => {
    /** @scenario "The actor sits beside the scenario version, not at the top level" */
    it("writes the actor into the reserved namespace, beside the case version", async () => {
      const command = await queuedCommandFor({
        id: "user_abc",
        label: "user",
      });

      const metadata = command.metadata as Record<string, unknown>;
      expect(metadata.langwatch).toEqual({
        targetReferenceId: "agent-1",
        targetType: "http",
        scenarioVersion: 4,
        actorId: "user_abc",
        actorLabel: "user",
      });
      expect(metadata).not.toHaveProperty("actorId");
      expect(metadata).not.toHaveProperty("actorLabel");
    });
  });

  describe("when the caller names no person", () => {
    /** @scenario "A run started by no person records no actor" */
    it("records neither the id nor the surface", async () => {
      const command = await queuedCommandFor();

      const langwatch = (
        command.metadata as { langwatch: Record<string, unknown> }
      ).langwatch;
      expect(langwatch).not.toHaveProperty("actorId");
      expect(langwatch).not.toHaveProperty("actorLabel");
      expect(langwatch).toEqual({
        targetReferenceId: "agent-1",
        targetType: "http",
        scenarioVersion: 4,
      });
    });
  });
});
