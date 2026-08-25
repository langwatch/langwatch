// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The emit seam: the pull effect writes its OCSF audit row and, for events
 * that carry priced usage, appends a `PulledUsageObserved` in the same loop.
 *
 * Spec: specs/governance/pulled-usage-cost-reporting.feature
 * Decision: ADR-088.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.hoisted` so the mock factories can close over these — `vi.mock` is
// lifted above every declaration in the file, which is what forces the dynamic
// import this replaces. With the doubles declared up here, `runIngestionPull`
// is an ordinary top-level import.
const { findUnique, insertEvent, runOnce, isEnabled } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  insertEvent: vi.fn(),
  runOnce: vi.fn(),
  isEnabled: vi.fn(),
}));

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: { isEnabled: (...a: unknown[]) => isEnabled(...a) },
}));
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
  AppIngestionCredentialsService: {
    create: () => ({ decrypt: () => ({ token: "sk-admin" }) }),
  },
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

import { runIngestionPull } from "../pullerWorker";

const SOURCE_ROW = {
  id: "src_1",
  organizationId: "org_acme",
  teamId: "team_platform",
  sourceType: "anthropic_admin",
  status: "active",
  parserConfig: { adapter: "test_adapter" },
} as const;

function usageEvent(
  hint: Record<string, unknown> = {},
  // The provider's own identity for the item. Overridable because two events
  // in one run are two DIFFERENT provider rows; sharing this id would model
  // the same item twice, and both `itemKey` and the OCSF event identity are
  // derived from it.
  sourceEventId = "usage:2026-08-01:ws_1",
) {
  return {
    source_event_id: sourceEventId,
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

const auditOnlyEvent = {
  ...usageEvent(),
  extra: { ip: "1.2.3.4" },
} as const;

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue(SOURCE_ROW);
  insertEvent.mockReset().mockResolvedValue(undefined);
  runOnce.mockReset();
  // The ADR-088 gate, on for every case except the one that asserts it.
  isEnabled.mockReset().mockResolvedValue(true);
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
          usageEvent({ dimensions: { workspaceId: "ws_2" } }, "usage:2026-08-01:ws_2"),
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

  describe("when the ADR-088 feature flag is off for the organization", () => {
    it("writes the audit row and records no cost at all", async () => {
      isEnabled.mockResolvedValue(false);
      runOnce.mockResolvedValue({
        events: [usageEvent()],
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

    it("resolves the flag once per run, not once per usage item", async () => {
      runOnce.mockResolvedValue({
        events: [
          usageEvent(),
          usageEvent({ dimensions: { w: "2" } }, "usage:2026-08-01:ws_2"),
        ],
        cursor: null,
        errorCount: 0,
      });

      await runIngestionPull({
        sourceId: "src_1",
        cursor: null,
        pulledUsage: {
          recordPulledUsage: vi.fn().mockResolvedValue(undefined),
        },
      });

      // The answer cannot change mid-batch, so a lookup per row would put
      // cost on the money path to decide nothing.
      expect(isEnabled).toHaveBeenCalledTimes(1);
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

  describe("when one item cannot be mapped to a usage record", () => {
    it("swallows it, so a malformed row cannot wedge the cursor behind it", async () => {
      runOnce.mockResolvedValue({
        events: [
          // Unparseable bucket timestamp: this row will never map, on this
          // pull or any later one.
          { ...usageEvent(), event_timestamp: "not-a-timestamp" },
          usageEvent({ dimensions: { workspaceId: "ws_2" } }, "usage:2026-08-01:ws_2"),
        ],
        cursor: "next",
        errorCount: 0,
      });
      const recordPulledUsage = vi.fn().mockResolvedValue(undefined);

      const result = await runIngestionPull({
        sourceId: "src_1",
        cursor: null,
        pulledUsage: { recordPulledUsage },
      });

      expect(result.nextCursor).toBe("next");
      // The failure is per item: only the mappable one is priced.
      expect(recordPulledUsage).toHaveBeenCalledTimes(1);
      // Both audit rows still landed, so the fact survives without a price.
      expect(insertEvent).toHaveBeenCalledTimes(2);
    });
  });

  describe("when appending a usage record fails", () => {
    it("fails the run, so the cursor holds and the window is retried", async () => {
      runOnce.mockResolvedValue({
        events: [usageEvent()],
        cursor: "next",
        errorCount: 0,
      });
      // A transient event-store outage, not a bad row: it heals by itself, and
      // advancing past it would lose this window's cost with nothing to retry.
      const recordPulledUsage = vi.fn().mockRejectedValue(new Error("ECONNRESET"));

      await expect(
        runIngestionPull({
          sourceId: "src_1",
          cursor: null,
          pulledUsage: { recordPulledUsage },
        }),
      ).rejects.toThrow("ECONNRESET");
    });
  });

  describe("when the cost flag cannot be resolved", () => {
    it("fails the run rather than filing the whole window at no cost", async () => {
      isEnabled.mockRejectedValue(new Error("flag service unreachable"));
      runOnce.mockResolvedValue({
        events: [usageEvent()],
        cursor: "next",
        errorCount: 0,
      });
      const recordPulledUsage = vi.fn().mockResolvedValue(undefined);

      await expect(
        runIngestionPull({
          sourceId: "src_1",
          cursor: null,
          pulledUsage: { recordPulledUsage },
        }),
      ).rejects.toThrow("flag service unreachable");
      expect(recordPulledUsage).not.toHaveBeenCalled();
    });
  });
});
