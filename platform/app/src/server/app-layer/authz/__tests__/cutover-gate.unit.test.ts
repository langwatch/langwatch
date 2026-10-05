import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import {
  cutoverOnEngine,
  invalidateCutoverGate,
  resetCutoverGateForTesting,
} from "../cutover-gate";

/**
 * The gate's whole contract is the two things a cutover needs from it: an
 * answer that is cheap enough to ask on every permission check, and one that
 * stops being true within a bounded window when an operator rolls the
 * organization back (specs/rbac/in-place-authz-migration.feature - "within the
 * gate's cache window").
 */
const projectionStub = (findUnique: ReturnType<typeof vi.fn>) =>
  ({ authzCutoverProjection: { findUnique } }) as unknown as Pick<
    PrismaClient,
    "authzCutoverProjection"
  >;

describe("cutoverOnEngine", () => {
  afterEach(() => {
    resetCutoverGateForTesting();
    vi.useRealTimers();
  });

  describe("given the projection marks the organization as on the engine", () => {
    it("answers true and serves the next ask from the cache", async () => {
      const findUnique = vi.fn().mockResolvedValue({ onEngine: true });
      const prisma = projectionStub(findUnique);

      expect(await cutoverOnEngine({ prisma, organizationId: "org-1" })).toBe(
        true,
      );
      expect(await cutoverOnEngine({ prisma, organizationId: "org-1" })).toBe(
        true,
      );

      expect(findUnique).toHaveBeenCalledTimes(1);
      expect(findUnique).toHaveBeenCalledWith({
        where: { organizationId: "org-1" },
        select: { onEngine: true },
      });
    });
  });

  describe("given no projection row for the organization", () => {
    it("answers false and caches that too, so a miss costs one read", async () => {
      const findUnique = vi.fn().mockResolvedValue(null);
      const prisma = projectionStub(findUnique);

      expect(await cutoverOnEngine({ prisma, organizationId: "org-1" })).toBe(
        false,
      );
      expect(await cutoverOnEngine({ prisma, organizationId: "org-1" })).toBe(
        false,
      );

      expect(findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe("given the projection row says the organization is not on the engine", () => {
    it("answers false", async () => {
      const prisma = projectionStub(
        vi.fn().mockResolvedValue({ onEngine: false }),
      );

      expect(await cutoverOnEngine({ prisma, organizationId: "org-1" })).toBe(
        false,
      );
    });
  });

  describe("given the projection cannot be read", () => {
    it("falls back to legacy rather than propagating the failure", async () => {
      const prisma = projectionStub(
        vi.fn().mockRejectedValue(new Error("connection refused")),
      );

      expect(await cutoverOnEngine({ prisma, organizationId: "org-1" })).toBe(
        false,
      );
    });

    it("caches the miss briefly, so an outage does not add a read per check", async () => {
      const findUnique = vi
        .fn()
        .mockRejectedValue(new Error("connection refused"));
      const prisma = projectionStub(findUnique);

      await cutoverOnEngine({ prisma, organizationId: "org-1" });
      await cutoverOnEngine({ prisma, organizationId: "org-1" });

      expect(findUnique).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the cache window elapses", () => {
    /** @scenario "Rolling back returns an organization to the legacy path within the gate's cache window" */
    it("re-reads a positive answer, which is what makes a rollback land", async () => {
      vi.useFakeTimers();
      const findUnique = vi
        .fn()
        .mockResolvedValueOnce({ onEngine: true })
        .mockResolvedValueOnce({ onEngine: false });
      const prisma = projectionStub(findUnique);

      expect(await cutoverOnEngine({ prisma, organizationId: "org-1" })).toBe(
        true,
      );
      vi.advanceTimersByTime(60_001);
      expect(await cutoverOnEngine({ prisma, organizationId: "org-1" })).toBe(
        false,
      );

      expect(findUnique).toHaveBeenCalledTimes(2);
    });

    it("re-reads a negative answer, which is what makes a completed cutover land", async () => {
      vi.useFakeTimers();
      const findUnique = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ onEngine: true });
      const prisma = projectionStub(findUnique);

      expect(await cutoverOnEngine({ prisma, organizationId: "org-1" })).toBe(
        false,
      );
      vi.advanceTimersByTime(60_001);
      expect(await cutoverOnEngine({ prisma, organizationId: "org-1" })).toBe(
        true,
      );

      expect(findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe("when two organizations ask", () => {
    it("caches each one's answer under its own key", async () => {
      const findUnique = vi
        .fn()
        .mockImplementation(
          ({ where }: { where: { organizationId: string } }) =>
            Promise.resolve({ onEngine: where.organizationId === "org-1" }),
        );
      const prisma = projectionStub(findUnique);

      expect(await cutoverOnEngine({ prisma, organizationId: "org-1" })).toBe(
        true,
      );
      expect(await cutoverOnEngine({ prisma, organizationId: "org-2" })).toBe(
        false,
      );
      expect(findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe("when a rollback invalidates one organization", () => {
    it("re-reads that organization immediately, without waiting out the window", async () => {
      const findUnique = vi
        .fn()
        .mockResolvedValueOnce({ onEngine: true })
        .mockResolvedValueOnce({ onEngine: false });
      const prisma = projectionStub(findUnique);

      expect(await cutoverOnEngine({ prisma, organizationId: "org-1" })).toBe(
        true,
      );
      invalidateCutoverGate({ organizationId: "org-1" });
      expect(await cutoverOnEngine({ prisma, organizationId: "org-1" })).toBe(
        false,
      );

      expect(findUnique).toHaveBeenCalledTimes(2);
    });

    it("leaves every other organization's cached answer alone", async () => {
      const findUnique = vi
        .fn()
        .mockImplementation(
          ({ where }: { where: { organizationId: string } }) =>
            Promise.resolve({ onEngine: where.organizationId === "org-2" }),
        );
      const prisma = projectionStub(findUnique);

      await cutoverOnEngine({ prisma, organizationId: "org-1" });
      await cutoverOnEngine({ prisma, organizationId: "org-2" });
      invalidateCutoverGate({ organizationId: "org-1" });

      expect(await cutoverOnEngine({ prisma, organizationId: "org-2" })).toBe(
        true,
      );
      expect(findUnique).toHaveBeenCalledTimes(2);
    });

    it("is safe for an organization the pod never cached", () => {
      expect(() =>
        invalidateCutoverGate({ organizationId: "org-never-seen" }),
      ).not.toThrow();
    });
  });

  describe("when the reset helper runs", () => {
    it("drops the cache, so a suite can cut an organization over mid-test", async () => {
      const findUnique = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ onEngine: true });
      const prisma = projectionStub(findUnique);

      expect(await cutoverOnEngine({ prisma, organizationId: "org-1" })).toBe(
        false,
      );
      resetCutoverGateForTesting();
      expect(await cutoverOnEngine({ prisma, organizationId: "org-1" })).toBe(
        true,
      );
    });
  });
});
