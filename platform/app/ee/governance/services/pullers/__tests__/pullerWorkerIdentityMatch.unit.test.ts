// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The match seam: a pull that discovers people hands the organization to the
 * injected identity-match port, after the run's own writes. The port is how
 * ADR-128 §12's gate is honoured — this worker never imports the engine's
 * suggestion half; the composition root does, on the worker role, and passes
 * it in (see `DiscoveredPeopleMatcher` in pullerWorker.ts).
 *
 * Spec: specs/governance/governance-people-screen.feature
 * Decision: ADR-128 §12.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, insertEvent, runOnce, isEnabled, recordFromPulledEvents } =
  vi.hoisted(() => ({
    findUnique: vi.fn(),
    insertEvent: vi.fn(),
    runOnce: vi.fn(),
    isEnabled: vi.fn(),
    recordFromPulledEvents: vi.fn(),
  }));

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: { isEnabled: (...a: unknown[]) => isEnabled(...a) },
}));
vi.mock("~/server/db", () => ({
  prisma: {
    ingestionSource: { findUnique: (...a: unknown[]) => findUnique(...a) },
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
// The discovery service is the seam under test's trigger, so its answer is
// controlled directly. The department sync gets its own no-op double beside
// it: both services would otherwise reach for prisma models this harness
// never builds.
vi.mock("../../personDiscovery.service", () => ({
  PersonDiscoveryService: {
    create: () => ({
      recordFromPulledEvents: (...a: unknown[]) => recordFromPulledEvents(...a),
    }),
  },
}));
vi.mock("../../directoryDepartmentSync.service", () => ({
  DirectoryDepartmentSyncService: {
    create: () => ({ applyDirectoryEvents: async () => undefined }),
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

const pulledEvent = {
  source_event_id: "evt_1",
  event_timestamp: "2026-08-01T00:00:00.000Z",
  actor: "casey@example-provider.test",
  action: "invoke",
  target: "anthropic/claude-sonnet-5",
  cost_usd: 0,
  tokens_input: 1,
  tokens_output: 1,
  raw_payload: "{}",
  extra: {},
} as const;

beforeEach(() => {
  findUnique.mockReset().mockResolvedValue(SOURCE_ROW);
  insertEvent.mockReset().mockResolvedValue(undefined);
  runOnce
    .mockReset()
    .mockResolvedValue({ events: [pulledEvent], cursor: null, errorCount: 0 });
  isEnabled.mockReset().mockResolvedValue(false);
  recordFromPulledEvents.mockReset().mockResolvedValue({ discovered: 1 });
});

describe("the pull run's identity-match seam", () => {
  describe("when a delivery discovers at least one person", () => {
    /** @scenario "Suggestions are recomputed when the feed discovers people" */
    it("hands the organization to the injected matcher, once, after the delivery's own writes", async () => {
      const runFor = vi.fn().mockResolvedValue(undefined);

      await runIngestionPull({
        sourceId: "src_1",
        cursor: null,
        identityMatch: { runFor },
      });

      expect(runFor).toHaveBeenCalledExactlyOnceWith({
        organizationId: "org_acme",
      });
      // "After the delivery's own writes" is a claim about order, so order is
      // what gets asserted: the OCSF audit row is the delivery's write, and
      // the matcher must not run until the events it would score are stored.
      expect(insertEvent.mock.invocationCallOrder[0]).toBeLessThan(
        runFor.mock.invocationCallOrder[0]!,
      );
    });

    it("still delivers the run when the matcher throws", async () => {
      const runFor = vi.fn().mockRejectedValue(new Error("scorer fell over"));

      await expect(
        runIngestionPull({
          sourceId: "src_1",
          cursor: null,
          identityMatch: { runFor },
        }),
      ).resolves.toMatchObject({ eventCount: 1, errorCount: 0 });
    });
  });

  describe("when the delivery discovers nobody", () => {
    it("never invokes the matcher — an empty feed is not a trigger", async () => {
      recordFromPulledEvents.mockResolvedValue({ discovered: 0 });
      const runFor = vi.fn();

      await runIngestionPull({
        sourceId: "src_1",
        cursor: null,
        identityMatch: { runFor },
      });

      expect(runFor).not.toHaveBeenCalled();
    });
  });

  describe("when no matcher is composed", () => {
    it("the run completes as it always did — the port is optional", async () => {
      await expect(
        runIngestionPull({ sourceId: "src_1", cursor: null }),
      ).resolves.toMatchObject({ eventCount: 1 });
    });
  });
});
