/**
 * The in-memory reservation store: the same contract the Redis store keeps,
 * driven without a datastore. The Redis script is proven against a real
 * Redis in the integration suite beside this one.
 *
 * @see ../instant-eval-budget-reservations.ts
 * @see specs/instant-evals/instant-eval-billing.feature
 */

import { describe, expect, it } from "vitest";

import { InMemoryInstantEvalBudgetReservations } from "../instant-eval-budget-reservations";

const ORG = "org_1";
const HOUR = 60 * 60 * 1000;

describe("given a store with sixty units of room", () => {
  describe("when two holds of forty are taken", () => {
    /** @scenario "Runs accepted together share the budget" */
    it("keeps the first and refuses the second, naming what is held", async () => {
      const store = new InMemoryInstantEvalBudgetReservations();

      const first = await store.reserve({
        organizationId: ORG,
        reservationId: "a",
        nanoUsd: 40,
        limitNanoUsd: 60,
        ttlMs: HOUR,
      });
      const second = await store.reserve({
        organizationId: ORG,
        reservationId: "b",
        nanoUsd: 40,
        limitNanoUsd: 60,
        ttlMs: HOUR,
      });

      expect(first).toEqual({ isReserved: true, heldNanoUsd: 40 });
      expect(second).toEqual({ isReserved: false, heldNanoUsd: 40 });
      await expect(store.heldNanoUsd({ organizationId: ORG })).resolves.toBe(
        40,
      );
    });
  });

  describe("when a hold is taken again under the same id", () => {
    it("replaces it rather than adding to it", async () => {
      const store = new InMemoryInstantEvalBudgetReservations();
      await store.reserve({
        organizationId: ORG,
        reservationId: "a",
        nanoUsd: 40,
        limitNanoUsd: 60,
        ttlMs: HOUR,
      });

      const again = await store.reserve({
        organizationId: ORG,
        reservationId: "a",
        nanoUsd: 50,
        limitNanoUsd: 60,
        ttlMs: HOUR,
      });

      expect(again).toEqual({ isReserved: true, heldNanoUsd: 50 });
    });
  });

  describe("when the total is read leaving one hold out", () => {
    /** @scenario "A run under way counts the runs accepted beside it" */
    it("sums only the others", async () => {
      const store = new InMemoryInstantEvalBudgetReservations();
      await store.reserve({
        organizationId: ORG,
        reservationId: "a",
        nanoUsd: 10,
        limitNanoUsd: 60,
        ttlMs: HOUR,
      });
      await store.reserve({
        organizationId: ORG,
        reservationId: "b",
        nanoUsd: 20,
        limitNanoUsd: 60,
        ttlMs: HOUR,
      });

      await expect(
        store.heldNanoUsd({ organizationId: ORG, except: "a" }),
      ).resolves.toBe(20);
      await expect(
        store.heldNanoUsd({ organizationId: "org_2" }),
      ).resolves.toBe(0);
    });
  });

  describe("when a hold is released or outlives its lifetime", () => {
    /** @scenario "A hold is released when the run's spend lands" */
    it("no longer counts", async () => {
      let now = 0;
      const store = new InMemoryInstantEvalBudgetReservations(() => now);
      await store.reserve({
        organizationId: ORG,
        reservationId: "released",
        nanoUsd: 10,
        limitNanoUsd: 60,
        ttlMs: HOUR,
      });
      await store.reserve({
        organizationId: ORG,
        reservationId: "lapsed",
        nanoUsd: 20,
        limitNanoUsd: 60,
        ttlMs: HOUR,
      });

      await store.release({ organizationId: ORG, reservationId: "released" });
      await store.release({ organizationId: ORG, reservationId: "never held" });
      await expect(store.heldNanoUsd({ organizationId: ORG })).resolves.toBe(
        20,
      );
      now = HOUR;
      await expect(store.heldNanoUsd({ organizationId: ORG })).resolves.toBe(0);
    });
  });
});
