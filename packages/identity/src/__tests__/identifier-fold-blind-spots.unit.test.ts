import { describe, expect, it } from "vitest";
import {
  T0,
  attached,
  erased,
  foldStream,
  foldUser,
  primaryChanged,
} from "./support/identifier-facts";

describe("what one head cannot see", () => {
  describe("given a partial replay window, which is the only way to reach these", () => {
    // ADR-127 names both of these. No command can state either shape —
    // `primaryChangeFacts` does not produce them — and they are pinned rather
    // than left to be discovered, because a per-identifier fold that agreed
    // everywhere would mean the split had changed nothing.

    describe("when a promotion's own head is outside the window", () => {
      /** @scenario "A promotion whose promoted head is absent still demotes the previous" */
      it("demotes the previous per identifier, where the person's fold demotes nobody", () => {
        const history = [
          attached({ identifierId: "idf_personal", state: "VERIFIED" }),
          primaryChanged({ identifierId: "idf_personal" }),
          // The attach of idf_work is not in the window; the promotion of it is.
          primaryChanged({
            identifierId: "idf_work",
            previousIdentifierId: "idf_personal",
            occurredAt: T0 + 7,
          }),
        ];
        // The person's fold makes the demotion conditional on the promotion
        // taking, and it did not take.
        expect(foldUser(history).identifiers.idf_personal?.state).toBe("PRIMARY");
        // One head cannot check that, so it demotes and the person is left with
        // no PRIMARY — which the read fork answers from the most recently
        // VERIFIED identifier.
        expect(
          foldStream({ identifierId: "idf_personal", facts: history })?.state,
        ).toBe("VERIFIED");
        expect(foldStream({ identifierId: "idf_work", facts: history })).toBeNull();
      });
    });

    describe("when a promotion names no previous and somebody is standing", () => {
      /** @scenario "A promotion naming no previous leaves an older PRIMARY standing" */
      it("leaves two PRIMARY per identifier, where the person's fold sweeps one away", () => {
        const history = [
          attached({ identifierId: "idf_personal", state: "VERIFIED" }),
          attached({
            identifierId: "idf_work",
            state: "VERIFIED",
            occurredAt: T0 + 1,
          }),
          primaryChanged({ identifierId: "idf_personal" }),
          // The shape the old guard could state: it named only the first
          // standing PRIMARY it found, and null when it found none.
          primaryChanged({ identifierId: "idf_work", occurredAt: T0 + 8 }),
        ];
        const perUser = foldUser(history);
        expect(perUser.identifiers.idf_personal?.state).toBe("VERIFIED");
        expect(perUser.identifiers.idf_work?.state).toBe("PRIMARY");
        // The fact is never routed to idf_personal, so its stream never hears.
        expect(
          foldStream({ identifierId: "idf_personal", facts: history })?.state,
        ).toBe("PRIMARY");
        expect(
          foldStream({ identifierId: "idf_work", facts: history })?.state,
        ).toBe("PRIMARY");
      });
    });

    describe("when an erasure names fewer identifiers than the person holds", () => {
      /** @scenario "Erasure folds the same both ways only because the fact names every head" */
      it("leaves the unnamed head's address standing per identifier", () => {
        const history = [
          attached({ identifierId: "idf_a" }),
          attached({
            identifierId: "idf_b",
            value: "sam@b.dev",
            occurredAt: T0 + 1,
          }),
          erased(["idf_a"]),
        ];
        // The person's fold sweeps every head and ignores the list.
        expect(foldUser(history).identifiers.idf_b?.value).toBeNull();
        // One head only hears what the fact names — which is why the command
        // builds that list from a read of the whole person.
        expect(
          foldStream({ identifierId: "idf_b", facts: history })?.value,
        ).toBe("sam@b.dev");
        expect(
          foldStream({ identifierId: "idf_a", facts: history })?.value,
        ).toBeNull();
      });
    });
  });
});
