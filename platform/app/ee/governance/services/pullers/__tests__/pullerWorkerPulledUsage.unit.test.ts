// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The emit seam: the pull effect writes its OCSF audit row and, for events
 * that carry priced usage, appends a `PulledUsageObserved` in the same loop.
 *
 * Spec: specs/governance/pulled-usage-cost-reporting.feature
 * Decision: ADR-088.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const insertEvent = vi.fn();
const runOnce = vi.fn();

vi.mock("~/server/db", () => ({
  prisma: {
    ingestionSource: { findUnique: (...a: unknown[]) => findUnique(...a) },
  },
}));
// The OCSF repository comes off the App (#6622 made `getApp()` the only way
// this file may reach ClickHouse), so that is what the double replaces.
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    governance: {
      ocsfEvents: { insertEvent: (...a: unknown[]) => insertEvent(...a) },
    },
  }),
}));
vi.mock("../../governanceOcsfEvents.clickhouse.repository", () => ({
  OCSF_ACTIVITY: { INVOKE: 1 },
  OCSF_SEVERITY: { INFO: 1 },
}));
vi.mock("../../governanceProject.service", () => ({
  ensureHiddenGovernanceProject: async () => ({ id: "proj_governance" }),
}));
vi.mock("../../activity-monitor/ingestionCredentials", () => ({
  decryptCredentials: () => ({ token: "sk-admin" }),
}));
vi.mock("../index", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    registerBuiltInPullers: () => undefined,
    pullerAdapterRegistry: {
      get: () => ({
        id: "test_adapter",
        validateConfig: (c: unknown) => c,
        runOnce: (...a: unknown[]) => runOnce(...a),
      }),
    },
  };
});

const { runIngestionPull } = await import("../pullerWorker");

const SOURCE_ROW = {
  id: "src_1",
  organizationId: "org_acme",
  teamId: "team_platform",
  sourceType: "anthropic_admin",
  status: "active",
  parserConfig: { adapter: "test_adapter" },
};

function usageEvent(hint: Record<string, unknown> = {}) {
  return {
    source_event_id: "usage:2026-08-01:ws_1",
    event_timestamp: "2026-08-01T00:00:00.000Z",
    actor: "",
    action: "usage_report",
    target: "anthropic/claude-sonnet-5",
    cost_usd: 0,
    tokens_input: 1_000,
    tokens_output: 100,
    raw_payload: "{}",
    extra: {
      pulled_usage: {
        costBasis: "computed",
        dimensions: { workspaceId: "ws_1", granularity: "1d" },
        model: "anthropic/claude-sonnet-5",
        ...hint,
      },
    },
  };
}

const auditOnlyEvent = { ...usageEvent(), extra: { ip: "1.2.3.4" } };

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue(SOURCE_ROW);
  insertEvent.mockReset().mockResolvedValue(undefined);
  runOnce.mockReset();
});

describe("the pull effect's pulled-usage emit seam", () => {
  describe("when an adapter returns a priced usage event", () => {
    it("appends one record carrying the source's own attribution", async () => {
      runOnce.mockResolvedValue({
        events: [usageEvent()],
        cursor: null,
        errorCount: 0,
      });
      const recordPulledUsage = vi.fn().mockResolvedValue(undefined);

      await runIngestionPull({
        sourceId: "src_1",
        cursor: null,
        pulledUsage: { recordPulledUsage },
      });

      expect(recordPulledUsage).toHaveBeenCalledTimes(1);
      const record = recordPulledUsage.mock.calls[0]![0];
      expect(record.organizationId).toBe("org_acme");
      expect(record.teamId).toBe("team_platform");
      expect(record.projectId).toBeNull();
      expect(record.costStatus).toBe("estimate");
      // The stream lives under the governance project; the money does not.
      expect(record.tenantId).toBe("proj_governance");
      expect(record.occurredAt).toBe(Date.parse("2026-08-01T00:00:00.000Z"));
    });

    it("still writes the audit row it always wrote", async () => {
      runOnce.mockResolvedValue({
        events: [usageEvent()],
        cursor: null,
        errorCount: 0,
      });

      await runIngestionPull({
        sourceId: "src_1",
        cursor: null,
        pulledUsage: { recordPulledUsage: vi.fn() },
      });

      expect(insertEvent).toHaveBeenCalledTimes(1);
    });

    it("gives every record in one run the same observation instant", async () => {
      runOnce.mockResolvedValue({
        events: [
          usageEvent(),
          usageEvent({ dimensions: { workspaceId: "ws_2" } }),
        ],
        cursor: null,
        errorCount: 0,
      });
      const recordPulledUsage = vi.fn().mockResolvedValue(undefined);

      await runIngestionPull({
        sourceId: "src_1",
        cursor: null,
        pulledUsage: { recordPulledUsage },
      });

      const [first, second] = recordPulledUsage.mock.calls.map((c) => c[0]);
      // observedAt orders restatements. Two records from one pull disagreeing
      // about it could order a correction behind the figure it corrects.
      expect(second.observedAtMs).toBe(first.observedAtMs);
    });
  });

  describe("when the event carries no priced usage", () => {
    it("records nothing and leaves the audit path alone", async () => {
      runOnce.mockResolvedValue({
        events: [auditOnlyEvent],
        cursor: null,
        errorCount: 0,
      });
      const recordPulledUsage = vi.fn();

      await runIngestionPull({
        sourceId: "src_1",
        cursor: null,
        pulledUsage: { recordPulledUsage },
      });

      expect(recordPulledUsage).not.toHaveBeenCalled();
      expect(insertEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the pulled-usage pipeline is not wired", () => {
    it("runs exactly as it did before, audit rows only", async () => {
      runOnce.mockResolvedValue({
        events: [usageEvent()],
        cursor: null,
        errorCount: 0,
      });

      const result = await runIngestionPull({
        sourceId: "src_1",
        cursor: null,
      });

      expect(result.eventCount).toBe(1);
      expect(insertEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe("when recording one item's cost fails", () => {
    it("does not fail the run, so one bad row cannot wedge the cursor", async () => {
      runOnce.mockResolvedValue({
        events: [
          usageEvent(),
          usageEvent({ dimensions: { workspaceId: "ws_2" } }),
        ],
        cursor: "next",
        errorCount: 0,
      });
      const recordPulledUsage = vi
        .fn()
        .mockRejectedValueOnce(new Error("append failed"))
        .mockResolvedValue(undefined);

      const result = await runIngestionPull({
        sourceId: "src_1",
        cursor: null,
        pulledUsage: { recordPulledUsage },
      });

      expect(result.nextCursor).toBe("next");
      // The failure is per item: the next one is still recorded.
      expect(recordPulledUsage).toHaveBeenCalledTimes(2);
      expect(insertEvent).toHaveBeenCalledTimes(2);
    });
  });
});
