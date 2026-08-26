import { describe, expect, it } from "vitest";
import {
  CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE,
  emptySsoConnection,
  reduceSsoConnection,
  type SsoArrivalPolicy,
  type SsoConnectionFact,
  ssoArrivalPolicy,
} from "../index";

/**
 * What each answer to "who gets in" leaves on the connection.
 *
 * `allowsJit` is a derived copy of the policy, kept so the sign-in read has
 * one indexed predicate, and its question is "may an unmatched subject be
 * PROVISIONED". Two of the three answers provision: `admit` makes a member,
 * `request` makes the account and stands a request beside it, because an
 * administrator answering a request needs somebody to answer about. Only
 * `refuse` provisions nobody.
 *
 * The fold said `=== "admit"`, so the middle answer folded to "provision
 * nobody" while still routing sign-ins - an organization that chose "they
 * ask, you approve" got no account, no request, and nobody to approve. The
 * pair is asserted together here because the bug was them disagreeing.
 */

const T0 = 1_756_000_000_000;

const policySet = (policy: SsoArrivalPolicy): SsoConnectionFact =>
  ({
    type: CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE,
    occurredAt: T0,
    data: {
      connectionId: "ssoconn_acme",
      policy,
      actor: { type: "user", id: "user_ana" },
      source: "self-serve",
    },
  }) as SsoConnectionFact;

const blank = () => emptySsoConnection({ connectionId: "ssoconn_acme" });

const after = (policy: SsoArrivalPolicy) =>
  reduceSsoConnection({ state: blank(), fact: policySet(policy) });

describe("given an administrator answering who a connection admits", () => {
  describe("when they answer 'they join automatically'", () => {
    /** @scenario "Each answer says whether an arrival is provisioned" */
    it("provisions, and reads back as admit", () => {
      const state = after("admit");

      expect(ssoArrivalPolicy(state)).toBe("admit");
      expect(state.allowsJit).toBe(true);
    });
  });

  describe("when they answer 'they ask, you approve'", () => {
    /** @scenario "Each answer says whether an arrival is provisioned" */
    it("still provisions, because a request needs somebody to be about", () => {
      const state = after("request");

      expect(ssoArrivalPolicy(state)).toBe("request");
      // The regression: this folded to false, so the arrival was routed and
      // then dropped — no account and no request to approve.
      expect(state.allowsJit).toBe(true);
    });
  });

  describe("when they answer 'nobody new'", () => {
    /** @scenario "Each answer says whether an arrival is provisioned" */
    it("provisions nobody", () => {
      const state = after("refuse");

      expect(ssoArrivalPolicy(state)).toBe("refuse");
      expect(state.allowsJit).toBe(false);
    });
  });

  describe("when nobody has answered at all", () => {
    it("keeps whatever the legacy field already said", () => {
      const legacy = { ...blank(), allowsJit: true };

      expect(ssoArrivalPolicy(legacy)).toBe("admit");
      expect(ssoArrivalPolicy(blank())).toBe("refuse");
    });
  });
});
