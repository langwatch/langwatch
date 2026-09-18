/**
 * `TraceExportBoundsService` — the export download's per-project rate window
 * and in-flight slots, resolved per caller tier through the entitlement peer.
 * @vitest-environment node
 */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { resolveRequestBound } from "@langwatch/plans";
import type { RateLimiter } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import {
  TraceExportBoundsService,
  type TraceExportSlotSet,
  type TraceExportSlotStore,
} from "../trace-export-bounds.service.ts";

const FREE_TIER_ORG = "org-free";
const ENTERPRISE_TIER_ORG = "org-enterprise";

const TIER_PLAN_TYPE: Record<string, string> = {
  [FREE_TIER_ORG]: "FREE",
  [ENTERPRISE_TIER_ORG]: "ENTERPRISE",
};

/** A real fixed window: each key counts its own checks, refused past the allowance named. */
function windowLimiter() {
  const used = new Map<string, number>();
  const limiter: RateLimiter = {
    check: (key, limit) => {
      const count = (used.get(key) ?? 0) + 1;
      used.set(key, count);
      const requests = limit?.requests ?? Number.POSITIVE_INFINITY;

      return Promise.resolve(
        count <= requests ? { allowed: true } : { allowed: false, retryAfterSeconds: 42 },
      );
    },
  };

  return { limiter, used };
}

/**
 * A real slot store: claims only a free key, DEL frees it, and every claim is
 * recorded so a test reads the TTL the crash safety rides on.
 */
function slotStore() {
  const held = new Map<string, string>();
  const claimCalls: [string, string, number][] = [];
  const store: TraceExportSlotStore = {
    claim: (key, value, expirySeconds) => {
      claimCalls.push([key, value, expirySeconds]);
      if (held.has(key)) return Promise.resolve(false);
      held.set(key, value);

      return Promise.resolve(true);
    },
    del: (key) => {
      const existed = held.delete(key);

      return Promise.resolve(existed ? 1 : 0);
    },
  };

  return { store, claimCalls };
}

function harness(tier: "free" | "enterprise" = "free") {
  const { limiter, used } = windowLimiter();
  const { store, claimCalls } = slotStore();
  const service = TraceExportBoundsService.create({
    entitlement: {
      requestBound: ({ key }) =>
        Promise.resolve(
          resolveRequestBound(
            key,
            TIER_PLAN_TYPE[tier === "free" ? FREE_TIER_ORG : ENTERPRISE_TIER_ORG],
          ),
        ),
    } as Pick<EntitlementApi, "requestBound">,
    projects: {
      getOrganizationId: () =>
        Promise.resolve(tier === "free" ? FREE_TIER_ORG : ENTERPRISE_TIER_ORG),
    } as Pick<ProjectApi, "getOrganizationId">,
    rateLimiter: limiter,
    redis: store,
  });

  return { service, used, claimCalls };
}

const FREE_EXPORTS_PER_MINUTE = resolveRequestBound("exportPerMinute", "FREE");
const FREE_EXPORT_SLOTS = resolveRequestBound("exportConcurrencyPerProject", "FREE");

describe("TraceExportBoundsService", () => {
  describe("given a free-tier project at its per-minute export ceiling", () => {
    it("refuses the next export 429 against the trace-export:<projectId> window", async () => {
      const { service, used } = harness();
      for (let index = 0; index < FREE_EXPORTS_PER_MINUTE; index++) {
        await service.assertExportWithinRate({ projectId: "project-1" });
      }

      const refusal = await service
        .assertExportWithinRate({ projectId: "project-1" })
        .catch((error: unknown) => error);

      expect(refusal).toMatchObject({
        code: "trace_export_rate_limited",
        httpStatus: 429,
        retryable: true,
        fault: "customer",
        meta: { retryAfterSeconds: 42 },
      });
      expect(used.get("trace-export:project-1")).toBe(FREE_EXPORTS_PER_MINUTE + 1);
    });
  });

  describe("given an enterprise project past the free per-minute ceiling", () => {
    it("lets the export through: the ceiling is tier-resolved, not static", async () => {
      const { service } = harness("enterprise");
      for (let index = 0; index < FREE_EXPORTS_PER_MINUTE; index++) {
        await service.assertExportWithinRate({ projectId: "project-1" });
      }

      await expect(
        service.assertExportWithinRate({ projectId: "project-1" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("given a free-tier project holding both its in-flight slots", () => {
    it("refuses a third concurrent export and frees a slot on release", async () => {
      const { service } = harness();
      const first = await service.acquireExportSlot({
        projectId: "project-1",
        exportId: "export-1",
      });
      await service.acquireExportSlot({ projectId: "project-1", exportId: "export-2" });
      expect(FREE_EXPORT_SLOTS).toBe(2);

      const refusal = await service
        .acquireExportSlot({ projectId: "project-1", exportId: "export-3" })
        .catch((error: unknown) => error);

      expect(refusal).toMatchObject({
        code: "trace_export_rate_limited",
        httpStatus: 429,
        message: "Too many trace exports already running for this project",
      });

      await first.release();

      await expect(
        service.acquireExportSlot({ projectId: "project-1", exportId: "export-4" }),
      ).resolves.toMatchObject({ release: expect.any(Function) });
    });
  });

  describe("given a slot claim", () => {
    it("claims the slot key with the 600-second crash-safety TTL", async () => {
      const { service, claimCalls } = harness();

      await service.acquireExportSlot({ projectId: "project-1", exportId: "export-1" });

      expect(claimCalls[0]).toEqual(["trace-export:slot:project-1:0", "export-1", 600]);
    });

    it("takes the first free slot index, not always slot zero", async () => {
      const { service, claimCalls } = harness();
      const first = await service.acquireExportSlot({
        projectId: "project-1",
        exportId: "export-1",
      });

      await service.acquireExportSlot({ projectId: "project-1", exportId: "export-2" });
      // Slot zero was tried and found held before slot one answered OK.
      expect(claimCalls[1]?.[0]).toBe("trace-export:slot:project-1:0");
      expect(claimCalls[2]?.[0]).toBe("trace-export:slot:project-1:1");

      await first.release();
      await service.acquireExportSlot({ projectId: "project-1", exportId: "export-3" });
      expect(claimCalls[3]?.[0]).toBe("trace-export:slot:project-1:0");
    });
  });
});

describe("TraceExportBoundsService.createOverRedis", () => {
  describe("given a free key", () => {
    it("claims it as SET key value EX seconds NX with the crash-safety TTL", async () => {
      const setCalls: Parameters<TraceExportSlotSet>[] = [];
      const set: TraceExportSlotSet = (...args) => {
        setCalls.push(args);

        return Promise.resolve("OK");
      };
      const service = TraceExportBoundsService.createOverRedis({
        entitlement: {
          requestBound: () => Promise.resolve(2),
        } as Pick<EntitlementApi, "requestBound">,
        projects: {
          getOrganizationId: () => Promise.resolve(FREE_TIER_ORG),
        } as Pick<ProjectApi, "getOrganizationId">,
        rateLimiter: windowLimiter().limiter,
        redis: { set, del: async () => 1 },
      });

      await service.acquireExportSlot({ projectId: "project-1", exportId: "export-1" });

      expect(setCalls[0]).toEqual(["trace-export:slot:project-1:0", "export-1", "EX", 600, "NX"]);
    });
  });

  describe("given a held key", () => {
    it("moves to the next slot index on the NX refusal", async () => {
      const setCalls: Parameters<TraceExportSlotSet>[] = [];
      const set: TraceExportSlotSet = (...args) => {
        setCalls.push(args);

        return Promise.resolve(setCalls.length === 1 ? null : "OK");
      };
      const service = TraceExportBoundsService.createOverRedis({
        entitlement: {
          requestBound: () => Promise.resolve(2),
        } as Pick<EntitlementApi, "requestBound">,
        projects: {
          getOrganizationId: () => Promise.resolve(FREE_TIER_ORG),
        } as Pick<ProjectApi, "getOrganizationId">,
        rateLimiter: windowLimiter().limiter,
        redis: { set, del: async () => 1 },
      });

      await expect(
        service.acquireExportSlot({ projectId: "project-1", exportId: "export-1" }),
      ).resolves.toMatchObject({ release: expect.any(Function) });
      expect(setCalls).toHaveLength(2);
    });
  });
});
