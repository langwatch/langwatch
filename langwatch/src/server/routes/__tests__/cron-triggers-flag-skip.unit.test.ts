/**
 * Cron flag-skip behaviour (ADR-034 Phase 5).
 *
 * When `release_es_graph_triggers_firing` is ON for a project, the cron
 * MUST skip that project's graph triggers — they're handled by the
 * event-sourced real-time reactor + heartbeat. When OFF, cron continues
 * processing as today. This test verifies the per-trigger flag check.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the cron's processCustomGraphTrigger so we observe call sites.
vi.mock("~/pages/api/cron/triggers/customGraphTrigger", async () => {
  const actual = await vi.importActual<typeof import("~/pages/api/cron/triggers/customGraphTrigger")>(
    "~/pages/api/cron/triggers/customGraphTrigger",
  );
  return {
    ...actual,
    processCustomGraphTrigger: vi.fn(async (trigger: { id: string }) => ({
      triggerId: trigger.id,
      status: "not_triggered",
    })),
  };
});

// Mock Prisma so we don't hit a real DB.
vi.mock("~/server/db", () => ({
  prisma: {
    project: { findMany: vi.fn(async () => [{ id: "p-on" }, { id: "p-off" }]) },
    trigger: {
      findMany: vi.fn(async () => [
        // Project p-on: flag-ON, has a graph trigger → cron must skip it.
        { id: "t-on", projectId: "p-on", customGraphId: "g-on", active: true },
        // Project p-off: flag-OFF, has a graph trigger → cron must process it.
        { id: "t-off", projectId: "p-off", customGraphId: "g-off", active: true },
        // A trace trigger (no customGraphId) → never enters this loop branch.
        { id: "t-trace", projectId: "p-off", customGraphId: null, active: true },
      ]),
    },
  },
}));

// Mock the feature flag service so we control per-project answers.
vi.mock("~/server/featureFlag", () => ({
  featureFlagService: {
    isEnabled: vi.fn(async (_key: string, opts: { projectId: string }) =>
      opts.projectId === "p-on",
    ),
  },
}));

const CRON_KEY = "test-cron-secret";

describe("cron flag-skip for event-sourced graph triggers", () => {
  let app: any;
  let processCustomGraphTriggerMock: ReturnType<typeof vi.fn>;
  let isEnabledMock: ReturnType<typeof vi.fn>;
  let originalKey: string | undefined;

  beforeAll(async () => {
    const cronMod = await import("../cron");
    app = cronMod.app;
    const graphMod = await import("~/pages/api/cron/triggers/customGraphTrigger");
    processCustomGraphTriggerMock =
      graphMod.processCustomGraphTrigger as unknown as ReturnType<typeof vi.fn>;
    const ffMod = await import("~/server/featureFlag");
    isEnabledMock = ffMod.featureFlagService.isEnabled as unknown as ReturnType<typeof vi.fn>;
  }, 30_000);

  beforeEach(() => {
    originalKey = process.env.CRON_API_KEY;
    process.env.CRON_API_KEY = CRON_KEY;
    processCustomGraphTriggerMock.mockClear();
    isEnabledMock.mockClear();
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.CRON_API_KEY;
    } else {
      process.env.CRON_API_KEY = originalKey;
    }
  });

  describe("when the flag is ON for a project", () => {
    it("skips that project's graph triggers", async () => {
      const res = await app.request("/api/cron/triggers", {
        headers: { authorization: `Bearer ${CRON_KEY}` },
      });
      expect(res.status).toBe(200);

      // p-on was checked and skipped.
      expect(isEnabledMock).toHaveBeenCalledWith(
        "release_es_graph_triggers_firing",
        expect.objectContaining({ projectId: "p-on" }),
      );
      // p-on's trigger NEVER reached processCustomGraphTrigger.
      const calledTriggerIds = processCustomGraphTriggerMock.mock.calls.map(
        (call) => (call[0] as { id: string }).id,
      );
      expect(calledTriggerIds).not.toContain("t-on");
    });

    it("still processes triggers for flag-OFF projects in the same batch", async () => {
      const res = await app.request("/api/cron/triggers", {
        headers: { authorization: `Bearer ${CRON_KEY}` },
      });
      expect(res.status).toBe(200);

      const calledTriggerIds = processCustomGraphTriggerMock.mock.calls.map(
        (call) => (call[0] as { id: string }).id,
      );
      expect(calledTriggerIds).toContain("t-off");
    });
  });
});
