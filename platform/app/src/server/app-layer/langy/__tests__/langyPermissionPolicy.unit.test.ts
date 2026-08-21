/**
 * @vitest-environment node
 *
 * @see specs/langy/langy-session-key.feature
 *
 * The policy's whole value is its DEFAULT. A rule that answers "granted"
 * for anything it has not heard of would quietly widen Langy's reach every time
 * the platform grows a resource family or an action. The policy is wide on
 * purpose now — full CRUD on tenant data, by owner decision — but WIDE and
 * FAIL-OPEN are different properties, and these tests are about the second:
 * the answer for things the policy has NEVER heard of, and the three
 * boundaries the owner drew (secrets unreadable, the auth scope read-only,
 * disclosure/rotation withheld).
 */
import { assert, describe, expect, it } from "vitest";

import { classifyForLangy } from "../langyPermissionPolicy";

// The cross-products live at module scope rather than as loops inside the
// `it`. Nested `describe`s already put a test body four levels deep, so a
// loop-in-a-loop there reads as tangled to any complexity measure — and a
// table plus `it.each` names the failing grain in the test report instead of
// burying it in one opaque assertion.

// The auth scope: every write grain on every family whose writes change who
// can do what, or change a credential. `view` is deliberately absent from the
// action list — the read half of the rule is asserted separately below.
const AUTH_SCOPE_WRITES = ["create", "update", "delete", "manage"].flatMap(
  (action) =>
    [
      "organization",
      "team",
      "project",
      "virtualKeys",
      "gatewayProviders",
      "webhookEndpoints",
      "auditLog",
      "complianceExport",
    ].map((family) => `${family}:${action}`),
);

// The actions no family may carry, because the user-permission ceiling does
// not bound them: public disclosure, credential rotation, cross-principal
// credential audit.
const CEILING_ESCAPING_GRAINS = [
  "traces:share",
  "virtualKeys:rotate",
  "virtualKeys:viewOtherPersonal",
];

// The widened surface this policy now exists to express: full CRUD on
// ordinary tenant data, including the grains the old allowlist refused.
const DELEGABLE_GRAINS = [
  "experiments:view",
  "prompts:view",
  "prompts:create",
  "prompts:manage",
  "evaluations:create",
  "traces:view",
  "project:view",
  "datasets:delete",
  "scenarios:manage",
  "triggers:create",
  "workflows:delete",
  // The auth scope READS — "auth scope read is okay" is half of the owner's
  // rule, and a boundary test that only asserts the refusals would let a
  // tightening quietly take the reads with it.
  "organization:view",
  "team:view",
  "virtualKeys:view",
  "auditLog:view",
];

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
        expect(verdict.reason).toContain("FULL_ACCESS_FAMILIES");
        expect(verdict.reason).toContain("AUTH_SCOPE_FAMILIES");
        expect(verdict.reason).toContain("FULLY_EXCLUDED_FAMILIES");
      });
    });
  });

  describe("given an action the policy has never heard of", () => {
    describe("when it is classified", () => {
      it("refuses it, even on a family Langy is otherwise fully trusted with", () => {
        // `prompts` carries full CRUD.
        expect(classifyForLangy("prompts:purge").disposition).toBe("excluded");
        expect(classifyForLangy("prompts:exfiltrate").disposition).toBe(
          "excluded",
        );
      });
    });
  });

  describe("given the secrets family", () => {
    describe("when any grain of it is classified", () => {
      it.each([
        "secrets:view",
        "secrets:create",
        "secrets:manage",
      ])("refuses %s — there is no safe read of a stored credential", (permission) => {
        expect(classifyForLangy(permission).disposition).toBe("excluded");
      });
    });
  });

  describe("given a write on the auth scope", () => {
    describe("when it is classified", () => {
      it.each(
        AUTH_SCOPE_WRITES,
      )("refuses %s, with the reason stated", (permission) => {
        const verdict = classifyForLangy(permission);

        expect(
          verdict.disposition,
          `${permission} writes the auth scope and must never be delegable`,
        ).toBe("excluded");
        // Narrows for the assertion below without a branch — a branch here
        // would silently pass on the `granted` verdict this test exists to
        // catch.
        assert(verdict.disposition === "excluded");
        expect(verdict.reason.length).toBeGreaterThan(0);
      });
    });
  });

  describe("given an action the user-permission ceiling does not bound", () => {
    describe("when it is classified", () => {
      it.each(
        CEILING_ESCAPING_GRAINS,
      )("refuses %s on every family, trusted or not", (permission) => {
        expect(classifyForLangy(permission).disposition).toBe("excluded");
      });
    });
  });

  describe("given the grains Langy is meant to have", () => {
    describe("when they are classified", () => {
      it.each(
        DELEGABLE_GRAINS,
      )("grants %s, so the policy is not vacuously strict", (permission) => {
        expect(
          classifyForLangy(permission).disposition,
          `${permission} should be delegable`,
        ).toBe("granted");
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
