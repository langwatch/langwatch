import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeedRunReport } from "../../../../scripts/dogfood/governance/_lib/seedRunner";

vi.mock("../../../../scripts/dogfood/governance/seed-demo", () => ({
  runSeedDemo: vi.fn(),
}));

const KEY = "test-cron-secret";

function makeReport(
  outcome: "succeeded" | "failed" = "succeeded",
): SeedRunReport {
  return {
    startedAt: "2026-05-09T00:00:00.000Z",
    completedAt: "2026-05-09T00:00:01.000Z",
    organizationId: "org_acme1234",
    organizationName: "ACME",
    mode: "execute",
    actions: [
      outcome === "succeeded"
        ? {
            name: "verifyOrgIdentity",
            outcome: { status: "succeeded", summary: "ok" },
            durationMs: 5,
          }
        : {
            name: "verifyOrgIdentity",
            outcome: { status: "failed", error: new Error("kaboom") },
            durationMs: 5,
          },
    ],
  };
}

describe("/api/cron/seed_demo", () => {
  let originalKey: string | undefined;
  let app: any;
  let runSeedDemoMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const cronMod = await import("../cron");
    app = cronMod.app;
    const seedMod = await import(
      "../../../../scripts/dogfood/governance/seed-demo"
    );
    runSeedDemoMock = seedMod.runSeedDemo as unknown as ReturnType<typeof vi.fn>;
  }, 30_000);

  beforeEach(() => {
    originalKey = process.env.CRON_API_KEY;
    process.env.CRON_API_KEY = KEY;
    runSeedDemoMock.mockReset();
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.CRON_API_KEY;
    } else {
      process.env.CRON_API_KEY = originalKey;
    }
  });

  describe("when the cron key header is missing", () => {
    it("returns 401 without invoking the seeder", async () => {
      const res = await app.request("/api/cron/seed_demo", { method: "POST" });
      expect(res.status).toBe(401);
      expect(runSeedDemoMock).not.toHaveBeenCalled();
    });
  });

  describe("when the cron key is wrong", () => {
    it("returns 401 without invoking the seeder", async () => {
      const res = await app.request("/api/cron/seed_demo", {
        method: "POST",
        headers: { authorization: "Bearer not-the-key" },
      });
      expect(res.status).toBe(401);
      expect(runSeedDemoMock).not.toHaveBeenCalled();
    });
  });

  describe("when the cron key is valid", () => {
    it("invokes runSeedDemo with execute=true", async () => {
      runSeedDemoMock.mockResolvedValue(makeReport("succeeded"));

      await app.request("/api/cron/seed_demo", {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}` },
      });

      expect(runSeedDemoMock).toHaveBeenCalledOnce();
      expect(runSeedDemoMock).toHaveBeenCalledWith({ execute: true });
    });

    it("returns 200 + report when all actions succeeded", async () => {
      const report = makeReport("succeeded");
      runSeedDemoMock.mockResolvedValue(report);

      const res = await app.request("/api/cron/seed_demo", {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { report: SeedRunReport };
      expect(body.report.organizationId).toBe(report.organizationId);
      expect(body.report.actions[0]?.outcome.status).toBe("succeeded");
    });

    it("returns 500 + report when any action failed", async () => {
      const report = makeReport("failed");
      runSeedDemoMock.mockResolvedValue(report);

      const res = await app.request("/api/cron/seed_demo", {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}` },
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { report: SeedRunReport };
      expect(body.report.actions[0]?.outcome.status).toBe("failed");
    });

    it("returns 500 + error when runSeedDemo throws", async () => {
      runSeedDemoMock.mockRejectedValue(new Error("scope misconfigured"));

      const res = await app.request("/api/cron/seed_demo", {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}` },
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe("scope misconfigured");
      expect(body.message).toBe("demo seed run threw");
    });

    it("accepts GET in addition to POST (Kubernetes CronJob curl pattern)", async () => {
      runSeedDemoMock.mockResolvedValue(makeReport("succeeded"));

      const res = await app.request("/api/cron/seed_demo", {
        method: "GET",
        headers: { authorization: `Bearer ${KEY}` },
      });
      expect(res.status).toBe(200);
      expect(runSeedDemoMock).toHaveBeenCalledWith({ execute: true });
    });
  });
});
