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
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { DataRetentionDirectoryReader } from "../../app/data-retention.app.ts";
import { CheckRetentionDriftCommand } from "../../eventing/retention-drift.commands.ts";
import type { CheckRetentionDriftCommandData } from "../../eventing/retention-drift.events.ts";
import { buildRetentionDriftPipeline } from "../../eventing/retention-drift.pipeline.ts";
import {
  RETENTION_DRIFT_INITIAL_STATE,
  retentionDriftWake,
} from "../../eventing/retention-drift.process.ts";
import { MemoryRetroactiveRetentionRepository } from "../../repositories/memory/memory.retroactive-retention.repository.ts";
import type { RetentionApplyStatusRepository } from "../../repositories/retention-apply-status.repository.ts";
import {
  RETENTION_DRIFT_WINDOW_MS,
  retentionDriftWindows,
} from "../../rules/retention-drift.rules.ts";
import type { ScopeApplyRecord } from "../../rules/stored-apply-status.rules.ts";
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

const ORGANIZATION = { scopeType: "ORGANIZATION" as const, scopeId: "organization-1" };
const TEAM = { scopeType: "TEAM" as const, scopeId: "team-1" };
const BEFORE = AT - 10 * DAY_MS;
const SAVED = AT - 5 * DAY_MS;

function harness({
  organizationIds = ["organization-1"],
  records = [] as ScopeApplyRecord[] | "unreadable",
} = {}) {
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
    applyStatus: createApiFixture<RetentionApplyStatusRepository>(
      {
        findForOrganization: async () => {
          if (records === "unreadable") throw new Error("projection store down");
          return records;
        },
      },
      "applyStatus",
    ),
    directory: createApiFixture<DataRetentionDirectoryReader>(
      {
        findOrganizationDirectory: async () => ({
          teams: [{ id: "team-1", name: "Payments" }],
          projects: [
            { id: "project-1", name: "One", teamId: "team-1", archived: false },
            { id: "project-2", name: "Two", teamId: "team-2", archived: false },
          ],
        }),
      },
      "directory",
    ),
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
          kind: "unexpected",
        },
      ]);
      expect(drifts.calls).toEqual([{ category: "traces", kind: "unexpected" }]);
      expect(lines.findLine("error", "retention other than")).toMatchObject({
        projectId: "project-1",
      });
    });
  });

  describe("when the organization saved a shorter period and did not apply it", () => {
    const deferredSave: ScopeApplyRecord = {
      ...ORGANIZATION,
      changedAt: SAVED,
      appliedAt: BEFORE,
      shortenedAt: SAVED,
      shortenedAtByCategory: { traces: SAVED },
    };

    /** @scenario "Rows kept longer after a shorter save that was not applied are deferred" */
    it("records rows kept longer as deferred, counted apart and warned, not an error", async () => {
      const { service, stamps, lines, drifts } = harness({ records: [deferredSave] });
      stamps.sampledStamps.set("project-1/traces", [{ retentionDays: 371, rows: 3 }]);

      await expect(service.check({ organizationId: "organization-1", at: AT })).resolves.toEqual([
        expect.objectContaining({ projectId: "project-1", category: "traces", kind: "deferred" }),
      ]);
      expect(drifts.calls).toEqual([{ category: "traces", kind: "deferred" }]);
      expect(lines.findLine("warn", "not applied")).toMatchObject({
        projectId: "project-1",
        kind: "deferred",
      });
      expect(lines.findLine("error", "retention other than")).toBeUndefined();
    });

    /** @scenario "Rows kept shorter than the setting are unexpected even under a deferred save" */
    it("records rows kept shorter as unexpected and logs an error", async () => {
      const { service, stamps, lines } = harness({ records: [deferredSave] });
      stamps.sampledStamps.set("project-1/traces", [
        { retentionDays: 371, rows: 3 },
        { retentionDays: 30, rows: 1 },
      ]);

      await expect(service.check({ organizationId: "organization-1", at: AT })).resolves.toEqual([
        expect.objectContaining({ projectId: "project-1", kind: "unexpected" }),
      ]);
      expect(lines.findLine("error", "retention other than")).toMatchObject({
        projectId: "project-1",
      });
    });
  });

  describe("when only traces were shortened and not applied", () => {
    /** @scenario "Drift in a category that was not shortened stays unexpected" */
    it("records experiments kept longer as unexpected beside deferred traces", async () => {
      const { service, stamps } = harness({
        records: [
          {
            ...ORGANIZATION,
            changedAt: SAVED,
            appliedAt: BEFORE,
            shortenedAt: SAVED,
            shortenedAtByCategory: { traces: SAVED },
          },
        ],
      });
      stamps.sampledStamps.set("project-1/traces", [{ retentionDays: 371, rows: 3 }]);
      stamps.sampledStamps.set("project-1/experiments", [{ retentionDays: 182, rows: 2 }]);

      const drifted = await service.check({ organizationId: "organization-1", at: AT });
      expect(drifted.map(({ category, kind }) => ({ category, kind }))).toEqual([
        { category: "traces", kind: "deferred" },
        { category: "experiments", kind: "unexpected" },
      ]);
    });
  });

  describe("when the shorter save was applied afterwards", () => {
    /** @scenario "Rows kept longer after the shorter save was applied are unexpected" */
    it("records rows still kept longer as unexpected", async () => {
      const { service, stamps, lines } = harness({
        records: [
          {
            ...ORGANIZATION,
            changedAt: SAVED,
            appliedAt: AT - DAY_MS,
            shortenedAt: SAVED,
            shortenedAtByCategory: { traces: SAVED },
          },
        ],
      });
      stamps.sampledStamps.set("project-1/traces", [{ retentionDays: 371, rows: 3 }]);

      await expect(service.check({ organizationId: "organization-1", at: AT })).resolves.toEqual([
        expect.objectContaining({ projectId: "project-1", kind: "unexpected" }),
      ]);
      expect(lines.findLine("error", "retention other than")).toBeDefined();
    });
  });

  describe("when the project's team saved a shorter period after the organization applied", () => {
    /** @scenario "A deferred save at a scope that holds the project covers it" */
    it("records the team's project as deferred and the other team's as unexpected", async () => {
      const { service, stamps } = harness({
        records: [
          {
            ...TEAM,
            changedAt: SAVED,
            appliedAt: null,
            shortenedAt: SAVED,
            shortenedAtByCategory: { traces: SAVED },
          },
          { ...ORGANIZATION, changedAt: null, appliedAt: BEFORE },
        ],
      });
      stamps.sampledStamps.set("project-1/traces", [{ retentionDays: 371, rows: 3 }]);
      stamps.sampledStamps.set("project-2/traces", [{ retentionDays: 371, rows: 3 }]);

      const drifted = await service.check({ organizationId: "organization-1", at: AT });
      expect(drifted.map(({ projectId, kind }) => ({ projectId, kind }))).toEqual([
        { projectId: "project-1", kind: "deferred" },
        { projectId: "project-2", kind: "unexpected" },
      ]);
    });
  });

  describe("when the organization's apply status cannot be read", () => {
    /** @scenario "An apply status that cannot be read leaves every drift unexpected" */
    it("records the drift as unexpected and logs the failure", async () => {
      const { service, stamps, lines } = harness({ records: "unreadable" });
      stamps.sampledStamps.set("project-1/traces", [{ retentionDays: 371, rows: 3 }]);

      await expect(service.check({ organizationId: "organization-1", at: AT })).resolves.toEqual([
        expect.objectContaining({ projectId: "project-1", kind: "unexpected" }),
      ]);
      expect(lines.findLine("warn", "could not read the apply status")).toMatchObject({
        organizationId: "organization-1",
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
