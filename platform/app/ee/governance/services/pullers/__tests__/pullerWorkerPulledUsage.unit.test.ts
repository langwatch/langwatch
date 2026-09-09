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
const { findUnique, update, insertEvent, runOnce, isEnabled } = vi.hoisted(
  () => ({
    findUnique: vi.fn(),
    update: vi.fn(),
    insertEvent: vi.fn(),
    runOnce: vi.fn(),
    isEnabled: vi.fn(),
  }),
);

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: { isEnabled: (...a: unknown[]) => isEnabled(...a) },
}));
vi.mock("~/server/db", () => ({
  prisma: {
    erasedIdentifierSuppression: { findMany: async () => [] },
    ingestionSource: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      // A run that drops a price records the window it lost. Pinned in
      // `pullerWorkerUnpricedWindow.unit.test.ts`; here it only has to exist.
      update: (...a: unknown[]) => update(...a),
    },
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

import {
  GovernanceCostRollupFoldProjection,
  governanceCostRollupTotals,
} from "../../../projections/governanceCostRollup.foldProjection";
import { azureCostEvents } from "../azureCostManagement";
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
  update.mockReset().mockResolvedValue(undefined);
  insertEvent.mockReset().mockResolvedValue(undefined);
  runOnce.mockReset();
  // The ADR-088 gate, on for every case except the one that asserts it.
  isEnabled.mockReset().mockResolvedValue(true);
});

describe("the pull effect's pulled-usage emit seam", () => {
  /** @scenario "A replacement Azure source restates the original bill" */
  it("keeps non-bill usage attached to the replacement source", async () => {
    findUnique.mockResolvedValue({
      ...SOURCE_ROW,
      id: "src_replacement",
      sourceType: "copilot_studio_dataverse",
      parserConfig: {
        adapter: "test_adapter",
        _azureBillSourceId: "src_original",
      },
    });
    runOnce.mockResolvedValue({
      events: [usageEvent({}, "conversation:123")],
      cursor: null,
      errorCount: 0,
    });
    const recordPulledUsage = vi.fn().mockResolvedValue(undefined);
    await runIngestionPull({
      sourceId: "src_replacement",
      cursor: null,
      pulledUsage: { recordPulledUsage },
    });
    expect(recordPulledUsage.mock.calls[0]![0].ingestionSourceId).toBe(
      "src_replacement",
    );
    expect(insertEvent.mock.calls[0]![0].sourceId).toBe("src_replacement");
  });

  /** @scenario "A replacement Azure source restates the original bill" */
  it("keeps the bill total when an archived source is replaced", async () => {
    const recordPulledUsage = vi.fn().mockResolvedValue(undefined);
    vi.useFakeTimers();
    try {
      for (const [index, id] of ["src_original", "src_replacement"].entries()) {
        vi.setSystemTime(new Date(`2026-09-09T0${index}:00:00Z`));
        findUnique.mockResolvedValue({
          ...SOURCE_ROW,
          id,
          sourceType: "copilot_studio_dataverse",
          createdAt: new Date("2026-09-01"),
          parserConfig: {
            adapter: "test_adapter",
            _azureBillSourceId: "src_original",
          },
        });
        runOnce.mockResolvedValue({
          events: azureCostEvents({
            subscriptionId: "subscription-1",
            days: [
              {
                day: "2026-09-08",
                meterCategory: "Copilot Studio",
                costMinor: index === 0 ? "100" : "125",
                costUsd: null,
                currencyCode: "USD",
              },
            ],
          }),
          cursor: null,
          errorCount: 0,
        });
        await runIngestionPull({
          sourceId: id,
          cursor: null,
          pulledUsage: { recordPulledUsage },
        });
      }
      const projection = new GovernanceCostRollupFoldProjection({
        store: { store: async () => undefined, get: async () => null },
      });
      const cells = new Map<string, ReturnType<typeof projection.init>>();
      for (const [index, [data]] of recordPulledUsage.mock.calls.entries()) {
        const event = {
          id: `event-${index}`,
          type: "lw.obs.pulled_usage.observed",
          tenantId: data.tenantId,
          aggregateId: data.restatementKey,
          occurredAt: data.occurredAt,
          data,
        } as never;
        const key = projection.key(event);
        cells.set(
          key,
          projection.apply(cells.get(key) ?? projection.init(), event),
        );
      }
      const total = [...cells.values()].reduce(
        (sum, state) =>
          sum + (governanceCostRollupTotals(state).amountNanoUsd ?? 0),
        0,
      );
      expect(total).toBe(125_000_000_000);
      expect(insertEvent.mock.calls[1]![0].sourceId).toBe("src_replacement");
    } finally {
      vi.useRealTimers();
    }
  });

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
      expect(record.costStatus).toBe("estimate");
      // Home and owner, side by side: the row is STORED under the governance
      // project — the event's own projectId, not just the stream's tenant —
      // and the money still belongs to the source's team (ADR-128).
      expect(record.projectId).toBe("proj_governance");
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
          usageEvent(
            { dimensions: { workspaceId: "ws_2" } },
            "usage:2026-08-01:ws_2",
          ),
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
          usageEvent(
            { dimensions: { workspaceId: "ws_2" } },
            "usage:2026-08-01:ws_2",
          ),
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
      const recordPulledUsage = vi
        .fn()
        .mockRejectedValue(new Error("ECONNRESET"));

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
