/**
 * @vitest-environment node
 * @see modules/auth/specs/sign-up.feature
 * Main's local sign-up decision over facts already read: routing, then an account, then methods.
 */
import type { RoutingDecision, SignInMethod } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { decideLocalSignUp, isSettledByRouting } from "../local-sign-up.rules.ts";

const PASSWORD: SignInMethod = { id: "password", kind: "password", connectionId: null };
const PASSKEY: SignInMethod = { id: "passkey", kind: "passkey", connectionId: null };
const UNKNOWN: RoutingDecision = {
  outcome: "route_to_signup",
  methodSet: [],
  reasonCode: "no_domain_match",
};
const ROUTED: RoutingDecision = {
  outcome: "redirect_to_connection",
  connectionId: "conn-1",
  methodSet: [{ id: "okta", kind: "federated", connectionId: "conn-1" }],
  reasonCode: "domain_routed",
};
const SUSPENDED: RoutingDecision = {
  outcome: "method_picker",
  methodSet: [],
  reasonCode: "connection_suspended",
};

function decide(overrides: Partial<Parameters<typeof decideLocalSignUp>[0]> = {}) {
  return decideLocalSignUp({
    decision: UNKNOWN,
    addressIsTaken: false,
    defaultMethods: [PASSWORD, PASSKEY],
    passwordIsAllowed: true,
    ...overrides,
  });
}

describe("decideLocalSignUp()", () => {
  describe("when an organization routes the address to its own connection", () => {
    /** @scenario "Registering an address an organization signs in through its own connection is refused in every sign-in mode" */
    it("hands it to that connection, whether or not an account exists", () => {
      expect(decide({ decision: ROUTED, addressIsTaken: true })).toEqual({
        outcome: "redirect",
        methodSet: ROUTED.methodSet,
        reasonCode: "domain_routed",
      });
      expect(isSettledByRouting(ROUTED)).toBe(true);
    });
  });

  describe("when the organization's connection is suspended", () => {
    /** @scenario "Registering an address an organization signs in through its own connection is refused in every sign-in mode" */
    it("answers unavailable on routing alone, whether or not an account exists", () => {
      expect(isSettledByRouting(SUSPENDED)).toBe(true);
      expect(decide({ decision: SUSPENDED, addressIsTaken: true })).toEqual({
        outcome: "unavailable",
        methodSet: [],
        reasonCode: "connection_suspended",
      });
    });
  });

  describe("when routing leaves the answer open", () => {
    it("settles nothing on routing alone", () => {
      expect(isSettledByRouting(UNKNOWN)).toBe(false);
    });

    /** @scenario "Registering an address that already has an account keeps its address proof" */
    it("answers existing_account for an address already held", () => {
      expect(decide({ addressIsTaken: true })).toEqual({
        outcome: "existing_account",
        methodSet: [],
        reasonCode: "account_methods",
      });
    });

    it("enrols the deployment's default methods for a new address", () => {
      expect(decide()).toEqual({
        outcome: "enroll",
        methodSet: [PASSWORD, PASSKEY],
        reasonCode: "no_domain_match",
      });
    });

    /** @scenario "Registering an address the sign-in routing offers no password is refused" */
    it("drops the password where passwords are not allowed", () => {
      expect(decide({ passwordIsAllowed: false }).methodSet).toEqual([PASSKEY]);
    });

    /** @scenario "Registering an address the sign-in routing offers no password is refused" */
    it("answers unavailable when nothing is left to offer", () => {
      expect(decide({ passwordIsAllowed: false, defaultMethods: [PASSWORD] })).toEqual({
        outcome: "unavailable",
        methodSet: [],
        reasonCode: "no_domain_match",
      });
    });

    /** @scenario "Registering an address the sign-in routing offers no password is refused" */
    it("answers unavailable for a routing outcome that offers no local sign-up", () => {
      const picker: RoutingDecision = {
        outcome: "method_picker",
        methodSet: [PASSWORD],
        reasonCode: "account_methods",
      };

      expect(decide({ decision: picker }).outcome).toBe("unavailable");
    });

    it("offers a method the routing named but could not license", () => {
      const unlicensed: RoutingDecision = {
        outcome: "method_picker",
        methodSet: [PASSWORD],
        reasonCode: "method_not_licensed",
      };

      expect(decide({ decision: unlicensed, defaultMethods: [] }).methodSet).toEqual([PASSWORD]);
    });
  });
});
