// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What a pull remembers about the money it was not allowed to keep.
 *
 * The pull cursor advances whether or not pulled cost recording is on, because
 * audit-only is a supported way to run a source. That makes the loss one-way:
 * the days already read have audit rows and no price, and nothing distinguishes
 * them from days that genuinely cost nothing. These cases pin the window that
 * makes the difference sayable, and the one re-read that closes it.
 *
 * Spec: specs/governance/pulled-usage-cost-reporting.feature
 * Decision: ADR-088.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    ingestionSource: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));
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

import { runIngestionPull } from "../pullerWorker";

const AUGUST_1 = "2026-08-01T00:00:00.000Z";
const AUGUST_2 = "2026-08-02T00:00:00.000Z";
const AUGUST_3 = "2026-08-03T00:00:00.000Z";

function sourceRow(
  window: {
    unpricedUsageSince?: Date | null;
    unpricedUsageThrough?: Date | null;
  } = {},
) {
  return {
    id: "src_1",
    organizationId: "org_acme",
    teamId: "team_platform",
    sourceType: "anthropic_admin",
    status: "active",
    parserConfig: { adapter: "test_adapter" },
    unpricedUsageSince: null,
    unpricedUsageThrough: null,
    ...window,
  };
}

/** A day the provider put a price on. `day` doubles as the item's identity. */
function pricedDay(day: string) {
  return {
    source_event_id: `cost:${day}:ws_1`,
    event_timestamp: day,
    actor: "",
    action: "cost_report",
    target: "anthropic/claude-sonnet-5",
    cost_usd: 0,
    tokens_input: 1_000,
    tokens_output: 100,
    raw_payload: "{}",
    extra: {
      pulled_usage: {
        costBasis: "computed",
        dimensions: { workspaceId: "ws_1", granularity: "1d", day },
        model: "anthropic/claude-sonnet-5",
      },
    },
  };
}

/** Same shape, no price on it — an ordinary audit row. */
function auditOnlyDay(day: string) {
  return { ...pricedDay(day), extra: { ip: "1.2.3.4" } };
}

/** The window written by the run, or null when the run wrote none. */
function windowWrittenBy(call: unknown[] | undefined): unknown {
  const args = call?.[0] as { data?: unknown } | undefined;
  return args?.data ?? null;
}

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue(sourceRow());
  update.mockReset().mockResolvedValue(undefined);
  insertEvent.mockReset().mockResolvedValue(undefined);
  runOnce.mockReset();
  isEnabled.mockReset().mockResolvedValue(true);
});

describe("the window a pull read but was not allowed to price", () => {
  describe("given this organization is not recording pulled cost", () => {
    /** @scenario "A day read without recording cost is remembered as unpriced" */
    it("records the day whose spend it dropped, so the day is not read as free", async () => {
      isEnabled.mockResolvedValue(false);
      runOnce.mockResolvedValue({
        events: [pricedDay(AUGUST_1)],
        cursor: "next",
        errorCount: 0,
      });
      const recordPulledUsage = vi.fn();

      await runIngestionPull({
        sourceId: "src_1",
        cursor: null,
        pulledUsage: { recordPulledUsage },
      });

      // The money was genuinely not stored — that part is the configured
      // behaviour and stays. What is new is that the source now says so.
      expect(recordPulledUsage).not.toHaveBeenCalled();
      expect(windowWrittenBy(update.mock.calls[0])).toEqual({
        unpricedUsageSince: new Date(AUGUST_1),
        unpricedUsageThrough: new Date(AUGUST_1),
      });
    });

    /** @scenario "The unpriced window spans the first lost day to the last" */
    it("spans the window from the first dropped day to the last", async () => {
      isEnabled.mockResolvedValue(false);
      runOnce.mockResolvedValue({
        events: [
          pricedDay(AUGUST_2),
          pricedDay(AUGUST_1),
          pricedDay(AUGUST_3),
        ],
        cursor: "next",
        errorCount: 0,
      });

      await runIngestionPull({
        sourceId: "src_1",
        cursor: null,
        pulledUsage: { recordPulledUsage: vi.fn() },
      });

      expect(windowWrittenBy(update.mock.calls[0])).toEqual({
        unpricedUsageSince: new Date(AUGUST_1),
        unpricedUsageThrough: new Date(AUGUST_3),
      });
    });

    /** @scenario "A later loss never shrinks an earlier one" */
    it("keeps the earlier loss when a later run drops a later day", async () => {
      isEnabled.mockResolvedValue(false);
      findUnique.mockResolvedValue(
        sourceRow({
          unpricedUsageSince: new Date(AUGUST_1),
          unpricedUsageThrough: new Date(AUGUST_1),
        }),
      );
      runOnce.mockResolvedValue({
        events: [pricedDay(AUGUST_3)],
        cursor: "next",
        errorCount: 0,
      });

      await runIngestionPull({
        sourceId: "src_1",
        cursor: null,
        pulledUsage: { recordPulledUsage: vi.fn() },
      });

      // Widen-only. A short run inside a long gap must not make the gap look
      // smaller than it is.
      expect(windowWrittenBy(update.mock.calls[0])).toEqual({
        unpricedUsageSince: new Date(AUGUST_1),
        unpricedUsageThrough: new Date(AUGUST_3),
      });
    });

    /** @scenario "A day that never carried a price is not remembered as lost" */
    it("claims no loss for a day that never carried a price", async () => {
      isEnabled.mockResolvedValue(false);
      runOnce.mockResolvedValue({
        events: [auditOnlyDay(AUGUST_1)],
        cursor: "next",
        errorCount: 0,
      });

      await runIngestionPull({
        sourceId: "src_1",
        cursor: null,
        pulledUsage: { recordPulledUsage: vi.fn() },
      });

      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("given this organization is recording pulled cost", () => {
    /** @scenario "Recording cost normally remembers no loss" */
    it("records no window, because nothing was dropped", async () => {
      runOnce.mockResolvedValue({
        events: [pricedDay(AUGUST_1)],
        cursor: "next",
        errorCount: 0,
      });
      const recordPulledUsage = vi.fn().mockResolvedValue(undefined);

      await runIngestionPull({
        sourceId: "src_1",
        cursor: null,
        pulledUsage: { recordPulledUsage },
      });

      expect(recordPulledUsage).toHaveBeenCalledTimes(1);
      expect(update).not.toHaveBeenCalled();
    });

    /** @scenario "Reading back across the whole window clears it" */
    it("forgets the window once a re-read reaches back across all of it", async () => {
      findUnique.mockResolvedValue(
        sourceRow({
          unpricedUsageSince: new Date(AUGUST_2),
          unpricedUsageThrough: new Date(AUGUST_3),
        }),
      );
      runOnce.mockResolvedValue({
        events: [
          // Starts before the gap, so every day inside it was read again.
          pricedDay(AUGUST_1),
          pricedDay(AUGUST_2),
          pricedDay(AUGUST_3),
        ],
        cursor: "next",
        errorCount: 0,
      });

      await runIngestionPull({
        sourceId: "src_1",
        cursor: null,
        pulledUsage: {
          recordPulledUsage: vi.fn().mockResolvedValue(undefined),
        },
      });

      expect(windowWrittenBy(update.mock.calls[0])).toEqual({
        unpricedUsageSince: null,
        unpricedUsageThrough: null,
      });
    });

    /** @scenario "A re-read that starts inside the window leaves it alone" */
    it("keeps the window when the re-read starts inside it, because half a repair is not one", async () => {
      findUnique.mockResolvedValue(
        sourceRow({
          unpricedUsageSince: new Date(AUGUST_1),
          unpricedUsageThrough: new Date(AUGUST_3),
        }),
      );
      runOnce.mockResolvedValue({
        events: [pricedDay(AUGUST_3)],
        cursor: "next",
        errorCount: 0,
      });

      await runIngestionPull({
        sourceId: "src_1",
        cursor: null,
        pulledUsage: {
          recordPulledUsage: vi.fn().mockResolvedValue(undefined),
        },
      });

      expect(update).not.toHaveBeenCalled();
    });
  });
});
