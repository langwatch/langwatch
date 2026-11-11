// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { afterEach, describe, expect, it, vi } from "vitest";

import { type ScimSeatLeaseApi, ScimSeatLeaseService } from "../scim-seat-lease.service.ts";

/** Organization's lease operations, recording every call in order. */
function leaseApi({ held = true }: { held?: boolean } = {}) {
  const calls: string[] = [];
  const api: ScimSeatLeaseApi = {
    acquireSeatLease: async ({ organizationId }) => {
      calls.push(`acquire:${organizationId}`);
      return { holder: "h1", renewEveryMs: 1_000 };
    },
    renewSeatLease: async ({ holder }) => {
      calls.push(`renew:${holder}`);
      return held;
    },
    releaseSeatLease: async ({ holder }) => {
      calls.push(`release:${holder}`);
    },
  };
  return { api, calls };
}

describe("ScimSeatLeaseService", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when the admission outlasts the renewal interval organization names", () => {
    it("renews the lease while it works, then releases it", async () => {
      vi.useFakeTimers();
      const { api, calls } = leaseApi();
      let finish: () => void = () => {};
      const work = new Promise<void>((resolve) => {
        finish = resolve;
      });

      const held = ScimSeatLeaseService.create(api).withSeatLock({
        organizationId: "org-acme",
        work: () => work,
      });
      await vi.advanceTimersByTimeAsync(2_500);
      finish();
      await held;

      expect(calls).toEqual(["acquire:org-acme", "renew:h1", "renew:h1", "release:h1"]);
    });
  });

  describe("when the admission fails", () => {
    it("still releases the lease and rethrows", async () => {
      const { api, calls } = leaseApi();
      const failure = new Error("membership write refused");

      await expect(
        ScimSeatLeaseService.create(api).withSeatLock({
          organizationId: "org-acme",
          work: async () => Promise.reject(failure),
        }),
      ).rejects.toBe(failure);
      expect(calls).toEqual(["acquire:org-acme", "release:h1"]);
    });
  });

  describe("when organization refuses the lease as busy", () => {
    it("runs no work and passes the refusal on", async () => {
      const busy = Object.assign(new Error("busy"), { code: "seat_change_busy" });
      const { api } = leaseApi();
      api.acquireSeatLease = async () => Promise.reject(busy);
      let runs = 0;

      await expect(
        ScimSeatLeaseService.create(api).withSeatLock({
          organizationId: "org-acme",
          work: async () => ++runs,
        }),
      ).rejects.toBe(busy);
      expect(runs).toBe(0);
    });
  });

  describe("when the lease went to another seat change before the membership write", () => {
    /** @scenario "A directory admission whose lease was taken over writes no membership" */
    it("refuses the write seat_change_busy and still releases its own lease", async () => {
      const { api, calls } = leaseApi({ held: false });
      const writes: string[] = [];

      await expect(
        ScimSeatLeaseService.create(api).withSeatLock({
          organizationId: "org-acme",
          work: async (lease) => {
            await lease.assertHeld();
            writes.push("membership");
          },
        }),
      ).rejects.toMatchObject({ code: "seat_change_busy" });
      expect(writes).toEqual([]);
      expect(calls).toEqual(["acquire:org-acme", "renew:h1", "release:h1"]);
    });
  });
});
