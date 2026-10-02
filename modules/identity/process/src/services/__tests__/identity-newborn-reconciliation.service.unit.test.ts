/**
 * The address-lock reaper the migration pass runs (ADR-116 §6).
 * @vitest-environment node
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import type { IdentityReservationRepository } from "../../repositories/identity-reservations.repository.ts";
import {
  IDENTITY_NEWBORN_ABANDONED_AFTER_MS,
  IdentityNewbornReconciliationService,
} from "../identity-newborn-reconciliation.service.ts";

const NOW = 1_690_000_000_000;

function harness({ reap }: { reap: IdentityReservationRepository["reapOrphans"] }) {
  const reapOrphans = vi.fn<IdentityReservationRepository["reapOrphans"]>(reap);
  const reservations: IdentityReservationRepository = {
    claim: async () => {
      throw new Error("the reaper never claims");
    },
    release: async () => 0,
    reapOrphans,
  };
  const service = IdentityNewbornReconciliationService.create({ reservations, now: () => NOW });

  return { service, reapOrphans };
}

describe("the address-lock reaper", () => {
  describe("given an address lock whose fact never landed", () => {
    describe("when the reaper runs", () => {
      /** @scenario "An address lock whose fact never landed is reaped" */
      /** @scenario An orphaned address lock is released so the address can be taken again */
      /** @scenario A lock whose ceremony is still in flight is left alone */
      it("reaps it behind the abandonment horizon", async () => {
        const { service, reapOrphans } = harness({ reap: async () => 2 });

        const summary = await service.runPass();

        expect(reapOrphans).toHaveBeenCalledWith(
          expect.objectContaining({
            olderThan: Temporal.Instant.fromEpochMilliseconds(
              NOW - IDENTITY_NEWBORN_ABANDONED_AFTER_MS,
            ),
          }),
        );
        expect(summary).toEqual({ locksReaped: 2 });
      });
    });

    describe("when the reservation store is unreachable", () => {
      it("reports nothing reaped so the next pass retries", async () => {
        const { service } = harness({
          reap: async () => {
            throw new Error("postgres unavailable");
          },
        });

        await expect(service.runPass()).resolves.toEqual({ locksReaped: 0 });
      });
    });
  });
});
