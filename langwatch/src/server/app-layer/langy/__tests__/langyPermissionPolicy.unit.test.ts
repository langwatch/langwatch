/**
 * @vitest-environment node
 *
 * @see specs/langy/langy-session-key.feature
 *
 * The policy's whole value is its DEFAULT. A blocklist that answers "granted"
 * for anything it has not heard of would quietly widen Langy's reach every time
 * the platform grows a resource family — and worse, the coverage sweep would
 * then go red until someone granted it, turning CI into pressure to hand an
 * assistant a capability nobody assessed.
 *
 * These tests are about the answer for things the policy has NEVER heard of.
 */
import { describe, expect, it } from "vitest";

import { classifyForLangy } from "../langyPermissionPolicy";

describe("classifyForLangy", () => {
  describe("given a resource family the policy has never heard of", () => {
    // Deliberately invented. If a real family is ever named any of these, the
    // point still holds — the test is about the DEFAULT, not these strings.
    const unknownFamilies = [
      "billing:create",
      "piiExport:create",
      "impersonation:update",
      "somethingNobodyHasWrittenYet:view",
    ];

    describe("when it is classified", () => {
      it("refuses it, so a family invented next quarter is not delegable before anyone assesses it", () => {
        for (const permission of unknownFamilies) {
          expect(
            classifyForLangy(permission).disposition,
            `${permission} must not be delegable by default`,
          ).toBe("excluded");
        }
      });

      it("says how to decide, so the refusal is a prompt rather than a dead end", () => {
        const verdict = classifyForLangy("billing:create");
        expect(verdict).toMatchObject({ disposition: "excluded" });
        if (verdict.disposition !== "excluded") throw new Error("unreachable");
        expect(verdict.reason).toContain("DELEGABLE_FAMILIES");
        expect(verdict.reason).toContain("OFF_LIMITS_FAMILIES");
      });
    });
  });

  describe("given an action the policy has never heard of", () => {
    describe("when it is classified", () => {
      it("refuses it, even on a family Langy is otherwise trusted with", () => {
        // `prompts` is fully delegable for view/create/update.
        expect(classifyForLangy("prompts:purge").disposition).toBe("excluded");
        expect(classifyForLangy("prompts:exfiltrate").disposition).toBe(
          "excluded",
        );
      });
    });
  });

  describe("given the destructive actions", () => {
    describe("when they are classified", () => {
      it("refuses every one, on every family, with the reason stated", () => {
        for (const action of ["manage", "delete", "share"]) {
          for (const family of ["prompts", "datasets", "traces"]) {
            const verdict = classifyForLangy(`${family}:${action}`);
            expect(
              verdict.disposition,
              `${family}:${action} must never be delegable`,
            ).toBe("excluded");
            if (verdict.disposition !== "excluded") continue;
            expect(verdict.reason.length).toBeGreaterThan(0);
          }
        }
      });
    });
  });

  describe("given the reads Langy is meant to have", () => {
    describe("when they are classified", () => {
      it("grants them, so the policy is not vacuously strict", () => {
        for (const permission of [
          "experiments:view",
          "prompts:view",
          "prompts:create",
          "evaluations:create",
          "traces:view",
          "project:view",
        ]) {
          expect(
            classifyForLangy(permission).disposition,
            `${permission} should be delegable`,
          ).toBe("granted");
        }
      });
    });
  });

  describe("given a string that is not a resource:action permission", () => {
    describe("when it is classified", () => {
      it("refuses it rather than guessing", () => {
        expect(classifyForLangy("nonsense").disposition).toBe("excluded");
        expect(classifyForLangy("").disposition).toBe("excluded");
      });
    });
  });
});
