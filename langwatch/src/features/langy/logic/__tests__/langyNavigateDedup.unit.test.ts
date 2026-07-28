import { describe, expect, it } from "vitest";
import { navigateDedupKey, reserveNavigate } from "../langyNavigateDedup";

describe("navigateDedupKey", () => {
  describe("given a turn id and a resolved destination", () => {
    it("combines them into one key", () => {
      expect(navigateDedupKey({ turnId: "turn-1", href: "/demo/simulations/set_1/batch_1?openRun=run_1" })).toBe(
        "turn-1:/demo/simulations/set_1/batch_1?openRun=run_1",
      );
    });
  });

  describe("given no active turn id yet", () => {
    it("still produces a stable key", () => {
      expect(navigateDedupKey({ turnId: null, href: "/demo/x" })).toBe(":/demo/x");
    });
  });
});

describe("reserveNavigate", () => {
  describe("given a turn's live stream is replayed after a reconnect", () => {
    describe("when the same navigate instruction is read again", () => {
      /** @scenario "A replayed stream tail does not fire the same navigation twice" */
      it("fires the navigation at most once for that instruction", () => {
        const seen = new Set<string>();
        const key = navigateDedupKey({
          turnId: "turn-1",
          href: "/demo/simulations/set_1/batch_1?openRun=run_1",
        });

        expect(reserveNavigate({ seen, key: key })).toBe(true);
        // A replayed stream tail hands the client the exact same instruction.
        expect(reserveNavigate({ seen, key: key })).toBe(false);
        expect(reserveNavigate({ seen, key: key })).toBe(false);
      });
    });
  });

  describe("given two DIFFERENT navigate instructions in the same turn", () => {
    it("fires both — the guard is per-instruction, not per-turn", () => {
      const seen = new Set<string>();
      const first = navigateDedupKey({ turnId: "turn-1", href: "/demo/a" });
      const second = navigateDedupKey({ turnId: "turn-1", href: "/demo/b" });

      expect(reserveNavigate({ seen, key: first })).toBe(true);
      expect(reserveNavigate({ seen, key: second })).toBe(true);
    });
  });

  describe("given the same destination navigated to across two different turns", () => {
    it("fires again for the new turn", () => {
      const seen = new Set<string>();
      const turnOne = navigateDedupKey({ turnId: "turn-1", href: "/demo/a" });
      const turnTwo = navigateDedupKey({ turnId: "turn-2", href: "/demo/a" });

      expect(reserveNavigate({ seen, key: turnOne })).toBe(true);
      expect(reserveNavigate({ seen, key: turnTwo })).toBe(true);
    });
  });
});
