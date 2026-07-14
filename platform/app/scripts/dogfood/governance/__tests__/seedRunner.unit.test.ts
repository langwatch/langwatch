import type { Organization, PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DemoOrgScope } from "../_lib/scopeGuard";
import {
  formatReport,
  reportHasFailures,
  runSeedActions,
  type SeedAction,
} from "../_lib/seedRunner";

function makePrismaMock(orgRow: Organization | null): PrismaClient {
  return {
    organization: {
      findUnique: vi.fn().mockResolvedValue(orgRow),
    },
  } as unknown as PrismaClient;
}

const ALLOWED_ORG_ID = "org_acme1234";
function makeOrgRow(): Organization {
  return {
    id: ALLOWED_ORG_ID,
    name: "ACME",
    slug: "acme",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Organization;
}

describe("runSeedActions", () => {
  let scope: DemoOrgScope;

  beforeEach(() => {
    scope = new DemoOrgScope([ALLOWED_ORG_ID]);
  });

  describe("when the org loads cleanly", () => {
    it("runs each action once and reports succeeded outcomes", async () => {
      const action1: SeedAction = {
        name: "first",
        run: vi.fn().mockResolvedValue({ status: "succeeded", summary: "ok-1" }),
      };
      const action2: SeedAction = {
        name: "second",
        run: vi.fn().mockResolvedValue({ status: "succeeded", summary: "ok-2" }),
      };

      const report = await runSeedActions({
        prisma: makePrismaMock(makeOrgRow()),
        scope,
        organizationId: ALLOWED_ORG_ID,
        actions: [action1, action2],
        execute: true,
      });

      expect(action1.run).toHaveBeenCalledOnce();
      expect(action2.run).toHaveBeenCalledOnce();
      expect(report.organizationId).toBe(ALLOWED_ORG_ID);
      expect(report.organizationName).toBe("ACME");
      expect(report.mode).toBe("execute");
      expect(report.actions).toHaveLength(2);
      expect(report.actions[0]?.outcome).toEqual({
        status: "succeeded",
        summary: "ok-1",
      });
      expect(report.actions[1]?.outcome).toEqual({
        status: "succeeded",
        summary: "ok-2",
      });
      expect(reportHasFailures(report)).toBe(false);
    });

    it("propagates dry-run flag into each action context", async () => {
      const action: SeedAction = {
        name: "spy",
        run: vi.fn().mockResolvedValue({ status: "succeeded", summary: "" }),
      };

      await runSeedActions({
        prisma: makePrismaMock(makeOrgRow()),
        scope,
        organizationId: ALLOWED_ORG_ID,
        actions: [action],
        execute: false,
      });

      expect(action.run).toHaveBeenCalledWith(
        expect.objectContaining({ execute: false }),
      );
    });

    it("captures action throws as failed outcomes without aborting the run", async () => {
      const action1: SeedAction = {
        name: "boom",
        run: vi.fn().mockRejectedValue(new Error("kaboom")),
      };
      const action2: SeedAction = {
        name: "after-boom",
        run: vi.fn().mockResolvedValue({ status: "succeeded", summary: "ok" }),
      };

      const report = await runSeedActions({
        prisma: makePrismaMock(makeOrgRow()),
        scope,
        organizationId: ALLOWED_ORG_ID,
        actions: [action1, action2],
        execute: true,
      });

      expect(action2.run).toHaveBeenCalledOnce();
      expect(report.actions[0]?.outcome.status).toBe("failed");
      if (report.actions[0]?.outcome.status === "failed") {
        expect(report.actions[0].outcome.error.message).toBe("kaboom");
      }
      expect(report.actions[1]?.outcome.status).toBe("succeeded");
      expect(reportHasFailures(report)).toBe(true);
    });
  });

  describe("when the target org is off the allowlist", () => {
    it("throws before any action runs", async () => {
      const action: SeedAction = {
        name: "should-not-run",
        run: vi.fn(),
      };

      await expect(
        runSeedActions({
          prisma: makePrismaMock(makeOrgRow()),
          scope,
          organizationId: "org_evil9999",
          actions: [action],
          execute: true,
        }),
      ).rejects.toThrow();
      expect(action.run).not.toHaveBeenCalled();
    });
  });
});

describe("formatReport", () => {
  it("renders mode + each action outcome", () => {
    const text = formatReport({
      startedAt: "2026-05-09T00:00:00.000Z",
      completedAt: "2026-05-09T00:00:01.000Z",
      organizationId: ALLOWED_ORG_ID,
      organizationName: "ACME",
      mode: "dry-run",
      actions: [
        {
          name: "verifyOrgIdentity",
          outcome: { status: "succeeded", summary: "org ready" },
          durationMs: 5,
        },
        {
          name: "fakeFailing",
          outcome: { status: "failed", error: new Error("nope") },
          durationMs: 12,
        },
      ],
    });
    expect(text).toContain("DRY-RUN");
    expect(text).toContain("verifyOrgIdentity (5ms): succeeded");
    expect(text).toContain("fakeFailing (12ms): failed");
    expect(text).toContain("nope");
    expect(text).toContain("at least one action failed");
  });

  it("renders 'all actions ran clean' when there are no failures", () => {
    const text = formatReport({
      startedAt: "x",
      completedAt: "y",
      organizationId: ALLOWED_ORG_ID,
      organizationName: "ACME",
      mode: "execute",
      actions: [
        {
          name: "single",
          outcome: { status: "succeeded", summary: "done" },
          durationMs: 1,
        },
      ],
    });
    expect(text).toContain("EXECUTE");
    expect(text).toContain("all actions ran clean");
    expect(text).not.toContain("failed");
  });
});
