import { SIGNIN_ROUTING_REASON_CODES } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { SIGN_IN_ROUTING_REASON_COPY, signInRoutingReasonCopy } from "../routing-reason-copy";

/**
 * The reason-code copy map is what stands between a routing decision and the
 * words a customer reads. These pin the properties that make it safe to render
 * whatever the router answers: every code the router can produce is accounted
 * for, no entry leaks a code slug or internal wording, and a code this build
 * has never heard of renders nothing rather than itself.
 */
describe("given the sign-in routing reason copy", () => {
  describe("when the router's whole vocabulary is walked", () => {
    it("accounts for every reason code the router can answer", () => {
      const covered = Object.keys(SIGN_IN_ROUTING_REASON_COPY);
      expect([...SIGNIN_ROUTING_REASON_CODES].sort()).toEqual(covered.sort());
    });

    it("writes guidance a person can act on, never a code", () => {
      for (const code of SIGNIN_ROUTING_REASON_CODES) {
        const copy = signInRoutingReasonCopy(code);
        if (!copy) continue;

        expect(copy.title.length).toBeGreaterThan(0);
        expect(copy.describe.length).toBeGreaterThan(0);
        expect(`${copy.title} ${copy.describe}`).not.toContain(code);
        expect(`${copy.title} ${copy.describe}`).not.toMatch(/_/);
        // House style: no em dashes anywhere in customer copy.
        expect(`${copy.title} ${copy.describe}`).not.toContain("—");
      }
    });
  });

  describe("when a code this build has never heard of arrives", () => {
    it("renders nothing rather than the code itself", () => {
      expect(signInRoutingReasonCopy("a_code_from_the_future")).toBeNull();
      expect(signInRoutingReasonCopy("toString")).toBeNull();
      expect(signInRoutingReasonCopy("")).toBeNull();
    });
  });
});
