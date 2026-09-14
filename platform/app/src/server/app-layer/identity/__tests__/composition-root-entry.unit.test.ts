/**
 * @vitest-environment node
 *
 * Entering the composition root FIRST.
 *
 * `server/better-auth/index.ts` builds its plugin list and its storage adapter
 * at module load out of `runtime.ts`'s exports, so a value import from
 * `runtime.ts` back to the better-auth instance is a cycle that only works one
 * way round: enter better-auth first and both modules finish, enter the
 * composition root first and better-auth evaluates against a half-initialized
 * one and dies on `Cannot access 'identityStorage' before initialization`.
 *
 * That asymmetry is why the operator lookup and two-step verification used to
 * be composed in satellite `*-runtime.ts` files. They are in `runtime.ts` now,
 * and what makes that safe is the edge running the other way: the adapters
 * hold a `BetterAuthInstanceHandle` that `better-auth/index.ts` fills, so the
 * identity tree never names the better-auth module as a value. This file is
 * the proof, and it works by being the import: the composition root is the
 * first module this suite loads, which is exactly the order that used to
 * crash.
 */
import { describe, expect, it } from "vitest";
import { identityStorageAdapter } from "../runtime";

describe("given the composition root and the better-auth instance", () => {
  describe("when the composition root is the first module loaded", () => {
    /** @scenario "The identity services are composed in one file" */
    it("finishes its own module body", () => {
      expect(typeof identityStorageAdapter()).toBe("function");
    });
  });
});
