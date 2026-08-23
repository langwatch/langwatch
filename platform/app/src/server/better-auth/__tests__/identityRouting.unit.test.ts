import {
  ROUTED_MODELS,
  routeWrite,
  WRITE_OPERATIONS,
} from "@langwatch/identity-server/better-auth";
import { describe, expect, it } from "vitest";

/**
 * The routing coverage pin (ADR-101 §2): the facade's routing table lives in
 * `@langwatch/identity-server`, but which better-auth models THIS deployment
 * mounts is the app's fact — its plugins, its options. A new model or
 * operation that better-auth starts writing to must land in the table and
 * in this pin in the same change, or the facade's unrouted-write throw plus
 * this test fail the build before production does.
 */
describe("identity adapter routing table", () => {
  describe("when the deployment's better-auth surface is enumerated", () => {
    /** @scenario "An unrouted better-auth write is refused and named" */
    it("classifies every mounted model and write operation explicitly", () => {
      for (const model of ROUTED_MODELS) {
        for (const operation of WRITE_OPERATIONS) {
          expect(() => routeWrite(model, operation)).not.toThrow();
        }
      }
      // Exact sets, not subsets.
      expect([...ROUTED_MODELS].sort()).toEqual([
        "account",
        "ratelimit",
        "session",
        "user",
        "verification",
      ]);
      expect(WRITE_OPERATIONS).toEqual([
        "create",
        "update",
        "updateMany",
        "delete",
        "deleteMany",
        "consumeOne",
        "incrementOne",
      ]);
      expect(() => routeWrite("twoFactor", "delete")).toThrow(
        /twoFactor.*delete/,
      );
    });
  });
});
