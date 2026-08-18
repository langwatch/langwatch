/**
 * The shape ./cutover-gate.ts and ./legacy-fallback-gate.ts both delegate to.
 * ./cutover-gate.unit.test.ts and rbac.legacy-fallback-gate.unit.test.ts
 * already cover the per-gate TTL/fail-safe contract through the two public
 * gates; this suite covers the two behaviours that live in the shared helper
 * itself and previously had no test anywhere: a read that throws is LOGGED,
 * and concurrent asks for the same cold key share one read.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { perOrganizationCachedFlag } from "../per-organization-cached-gate";

// The module under test calls `createLogger` once, at import time (the
// module-scope `const logger = createLogger(...)` every gate in this
// package uses) - the spy has to exist before that call runs, hence
// `vi.hoisted` (and `vi.mock`, itself hoisted above every import in this
// file by vitest) rather than setting it up inside a test.
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ warn }),
}));

describe("perOrganizationCachedFlag", () => {
  afterEach(() => {
    warn.mockClear();
  });

  function gate(
    overrides?: Partial<Parameters<typeof perOrganizationCachedFlag>[0]>,
  ) {
    return perOrganizationCachedFlag({
      name: "test-gate",
      positiveTtlMs: 60_000,
      negativeTtlMs: 60_000,
      ...overrides,
    });
  }

  describe("when two reads for the same cold organization race", () => {
    it("runs the read once and answers both callers", async () => {
      const flag = gate();
      let calls = 0;
      const read = () =>
        new Promise<boolean>((resolve) => {
          calls += 1;
          setTimeout(() => resolve(true), 5);
        });

      const [first, second] = await Promise.all([
        flag.get({ organizationId: "org-1", read }),
        flag.get({ organizationId: "org-1", read }),
      ]);

      expect(first).toBe(true);
      expect(second).toBe(true);
      expect(calls).toBe(1);
    });

    it("keeps two different organizations independent", async () => {
      const flag = gate();
      let calls = 0;
      const readFor = (value: boolean) => () => {
        calls += 1;
        return Promise.resolve(value);
      };

      const [org1, org2] = await Promise.all([
        flag.get({ organizationId: "org-1", read: readFor(true) }),
        flag.get({ organizationId: "org-2", read: readFor(false) }),
      ]);

      expect(org1).toBe(true);
      expect(org2).toBe(false);
      expect(calls).toBe(2);
    });
  });

  describe("when the read throws", () => {
    it("answers false rather than propagating the failure", async () => {
      const flag = gate();
      const result = await flag.get({
        organizationId: "org-1",
        read: () => Promise.reject(new Error("connection refused")),
      });
      expect(result).toBe(false);
    });

    it("logs a warning naming the organization, the gate and the error", async () => {
      const flag = gate();
      const error = new Error("connection refused");

      await flag.get({
        organizationId: "org-1",
        read: () => Promise.reject(error),
      });

      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          gate: "test-gate",
          error,
        }),
        expect.any(String),
      );
    });

    it("caches the failure briefly rather than re-reading on the next ask", async () => {
      const flag = gate();
      let calls = 0;
      const read = () => {
        calls += 1;
        return Promise.reject(new Error("connection refused"));
      };

      await flag.get({ organizationId: "org-1", read });
      await flag.get({ organizationId: "org-1", read });

      expect(calls).toBe(1);
    });
  });

  describe("when resetForTesting runs", () => {
    it("drops both the cache and any in-flight bookkeeping", async () => {
      const flag = gate();
      await flag.get({
        organizationId: "org-1",
        read: () => Promise.resolve(true),
      });

      flag.resetForTesting();

      let calls = 0;
      await flag.get({
        organizationId: "org-1",
        read: () => {
          calls += 1;
          return Promise.resolve(true);
        },
      });
      expect(calls).toBe(1);
    });
  });
});
