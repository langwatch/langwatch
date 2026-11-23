/**
 * @vitest-environment node
 * The drift check's clock, its per-organization requests, the windows it samples and how a
 * failing read or send is contained.
 * @see modules/data-retention/specs/retention-drift-check.feature
 */
import type { ResolvedRetention } from "@langwatch/data-retention-contract";
import { EventSourcing, InMemoryProcessStore } from "@langwatch/eventing";
import { EventStoreMemory, intentAccessorOf } from "@langwatch/eventing/testing";
import type { CounterHandle } from "@langwatch/observability/metrics";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it, vi } from "vitest";

import { CheckRetentionDriftCommand } from "../../eventing/retention-drift.commands.ts";
import type { CheckRetentionDriftCommandData } from "../../eventing/retention-drift.events.ts";
import { buildRetentionDriftPipeline } from "../../eventing/retention-drift.pipeline.ts";
import {
  RETENTION_DRIFT_INITIAL_STATE,
  retentionDriftWake,
} from "../../eventing/retention-drift.process.ts";
import { MemoryRetroactiveRetentionRepository } from "../../repositories/memory/memory.retroactive-retention.repository.ts";
import {
  RETENTION_DRIFT_WINDOW_MS,
  retentionDriftWindows,
} from "../../rules/retention-drift.rules.ts";
import { RetentionDriftCheckService } from "../retention-drift-check.service.ts";
import { RetentionDriftRequestService } from "../retention-drift-request.service.ts";

const AT = Date.UTC(2026, 10, 22, 4);
const DAY_MS = 86_400_000;
const resolved = (days: number): ResolvedRetention => ({
  traces: days,
  scenarios: days,
  experiments: days,
});

function recordingCounter(): CounterHandle & { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return { calls, inc: (attributes) => void calls.push({ ...attributes }) };
}

function harness({ organizationIds = ["organization-1"] } = {}) {
  const stamps = MemoryRetroactiveRetentionRepository.create();
  const { logger, lines } = createTestLogger();
  const drifts = recordingCounter();
  const requests = RetentionDriftRequestService.create({
    policies: { findOrganizationIdsWithRules: async () => organizationIds },
    logger,
  });
  const service = RetentionDriftCheckService.create({
    projects: {
      findScopeProjectIds: async () => ["project-1", "project-2"],
      getResolvedForProjects: async ({ projectIds }) =>
        new Map(projectIds.map((projectId) => [projectId, resolved(91)])),
    },
    stamps,
    logger,
    drifts,
  });
  return { service, requests, stamps, lines, drifts };
}

describe("the drift check's daily wake", () => {
  describe("when the clock wakes", () => {
    /** @scenario "The daily wake asks for one check per organization with rules" */
    it("asks for one sweep keyed by the wake, then one check per organization", async () => {
      const context = {
        at: AT,
        now: AT,
        key: "retentionDriftCheck",
        projectId: "__global__",
        intent: intentAccessorOf({
          sweep: (messageKey, payload) => ({ messageKey, intentType: "sweep", payload }),
        }),
      };
      const first = retentionDriftWake(RETENTION_DRIFT_INITIAL_STATE, context);
      const again = retentionDriftWake({ lastSweepAt: AT }, context);
      expect(first.intents).toEqual(again.intents);
      expect(first.intents).toEqual([
        { messageKey: `sweep:${AT}`, intentType: "sweep", payload: { scheduledFor: AT } },
      ]);

      const { requests } = harness({ organizationIds: ["organization-1", "organization-2"] });
      const sent: CheckRetentionDriftCommandData[] = [];
      requests.connect(async (data) => void sent.push(data));
      await expect(requests.requestAll({ at: AT })).resolves.toEqual({ requested: 2, failed: 0 });
      expect(sent.map((each) => each.organizationId)).toEqual(["organization-1", "organization-2"]);
      expect(sent.every((each) => each.occurredAt === AT)).toBe(true);
    });

    it("runs the sweep through the scheduled pipeline's commands", async () => {
      const eventing = new EventSourcing({
        eventStore: EventStoreMemory.createForTesting(),
        processStore: InMemoryProcessStore.createForTesting(),
      });
      try {
        const { requests } = harness();
        const checked = vi.fn(async () => []);
        const registered = eventing.register(
          buildRetentionDriftPipeline({
            checkCommand: CheckRetentionDriftCommand.create({ checker: { check: checked } }),
            sweep: {
              request: ({ at }) => requests.requestAll({ at }),
              deleteDispatchedBefore: async () => 0,
            },
          }),
        );
        requests.connect((data) => registered.commands.checkRetentionDrift.send(data));
        await requests.requestAll({ at: AT });
        await vi.waitFor(() =>
          expect(checked).toHaveBeenCalledWith({ organizationId: "organization-1", at: AT }),
        );
      } finally {
        await eventing.close();
      }
    });
  });

  describe("when sending the check for one organization fails", () => {
    /** @scenario "An organization whose check cannot be sent is counted, not fatal" */
    it("still asks the others and counts and logs the failure", async () => {
      const { requests, lines } = harness({
        organizationIds: ["organization-1", "organization-2"],
      });
      const sent: string[] = [];
      requests.connect(async (data) => {
        if (data.organizationId === "organization-1") throw new Error("queue down");
        sent.push(data.organizationId);
      });
      await expect(requests.requestAll({ at: AT })).resolves.toEqual({ requested: 1, failed: 1 });
      expect(sent).toEqual(["organization-2"]);
      expect(lines.findLine("error", "could not be requested")).toBeDefined();
    });
  });
});

describe("the windows the check samples", () => {
  /** @scenario "The windows sampled are a few short slices spread over the stored age" */
  it("chooses at most ten one-hour windows, none newer than a day", () => {
    const windows = retentionDriftWindows({ nowMs: AT });
    expect(windows.length).toBeLessThanOrEqual(10);
    expect(windows.every(({ fromMs, toMs }) => toMs - fromMs === RETENTION_DRIFT_WINDOW_MS)).toBe(
      true,
    );
    expect(windows.every(({ toMs }) => toMs <= AT - DAY_MS)).toBe(true);
  });
});

describe("an organization's check", () => {
  describe("when one project's stored traces carry another period", () => {
    it("reports that project alone, on the metric and in the log", async () => {
      const { service, stamps, lines, drifts } = harness();
      stamps.sampledStamps.set("project-1/traces", [
        { retentionDays: 91, rows: 4 },
        { retentionDays: 30, rows: 2 },
      ]);
      stamps.sampledStamps.set("project-2/traces", [{ retentionDays: 91, rows: 5 }]);

      await expect(service.check({ organizationId: "organization-1", at: AT })).resolves.toEqual([
        {
          projectId: "project-1",
          category: "traces",
          expectedDays: 91,
          found: [{ retentionDays: 30, rows: 2 }],
        },
      ]);
      expect(drifts.calls).toEqual([{ category: "traces" }]);
      expect(lines.findLine("error", "retention other than")).toMatchObject({
        projectId: "project-1",
      });
    });
  });

  describe("when reading one project's stored rows fails", () => {
    /** @scenario "A project whose rows cannot be read is skipped and the rest are checked" */
    it("still checks the other project and logs the failure", async () => {
      const { service, stamps, lines } = harness();
      stamps.refuseSampleFor.add("project-1");
      stamps.sampledStamps.set("project-2/scenarios", [{ retentionDays: 7, rows: 1 }]);

      const drifted = await service.check({ organizationId: "organization-1", at: AT });
      expect(drifted).toEqual([expect.objectContaining({ projectId: "project-2" })]);
      expect(lines.findLine("warn", "could not read")).toMatchObject({ projectId: "project-1" });
    });
  });
});
