/**
 * @vitest-environment node
 *
 * Corresponds to specs/identity/identity-storage-adapter.feature.
 */
import type { IdentityReservationRepository } from "@langwatch/identity-server";
import { describe, expect, it, vi } from "vitest";
import {
  IDENTITY_ADDRESS_LOCK_ORPHAN_AFTER_MS,
  IdentityAddressLockReaperService,
} from "../address-lock-reaper";

const NOW = Date.parse("2026-09-11T12:00:00.000Z");

function reaperOver(reapOrphans: ReturnType<typeof vi.fn>) {
  return new IdentityAddressLockReaperService({
    reservations: { reapOrphans } as unknown as IdentityReservationRepository,
    now: () => NOW,
  });
}

describe("IdentityAddressLockReaperService", () => {
  describe("when a pass runs", () => {
    /** @scenario "An orphaned address lock is released so the address can be taken again" */
    it("reaps behind the horizon, bounded, and reports what it released", async () => {
      const reapOrphans = vi.fn(async () => 3);

      const summary = await reaperOver(reapOrphans).runPass();

      expect(summary).toEqual({ locksReaped: 3 });
      expect(reapOrphans).toHaveBeenCalledWith({
        olderThan: new Date(NOW - IDENTITY_ADDRESS_LOCK_ORPHAN_AFTER_MS),
        limit: 200,
      });
    });

    /** @scenario "A lock whose ceremony is still in flight is left alone" */
    it("keeps the horizon an hour back, so an in-flight ceremony keeps its claim", async () => {
      const reapOrphans = vi.fn(async () => 0);

      await reaperOver(reapOrphans).runPass();

      expect(reapOrphans).toHaveBeenCalledWith(
        expect.objectContaining({
          olderThan: new Date(NOW - 60 * 60 * 1000),
        }),
      );
    });
  });

  describe("when the repository throws", () => {
    /** @scenario "The address-lock reap runs on every migration pass" */
    it("lets the failure out, because the pass leg owns the catch", async () => {
      const reapOrphans = vi.fn(async () => {
        throw new Error("database unavailable");
      });

      await expect(reaperOver(reapOrphans).runPass()).rejects.toThrow(
        "database unavailable",
      );
    });
  });
});
