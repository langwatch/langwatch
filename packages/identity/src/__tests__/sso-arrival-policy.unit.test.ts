import { describe, expect, it } from "vitest";
import {
  CONNECTION_ARRIVAL_POLICY_SET_EVENT_TYPE,
  DEFAULT_SSO_ARRIVAL_POLICY,
  emptySsoConnection,
  reduceSsoConnection,
  type SsoArrivalPolicy,
  type SsoConnectionFact,
  ssoArrivalPolicy,
} from "../index";

/**
 * What each answer to "who gets in" leaves on the connection.
 *
 * There is ONE field. There were two — this policy and a boolean `allowsJit`
 * derived from it — and the derivation said `=== "admit"`, so the middle
 * answer folded to "provision nobody" while still routing sign-ins: an
 * organization that chose "they ask, you approve" got no account, no request,
 * and nobody to approve. The two could disagree because there were two.
 *
 * What survives is the distinction that actually matters, and it is asserted
 * below rather than assumed: two of the three answers PROVISION. `admit`
 * makes a member; `request` makes the account and stands a request beside it,
 * because an administrator answering a request needs somebody to answer
 * about. Only `refuse` provisions nobody.
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
  describe.each([
    ["they join automatically", "admit"],
    ["they ask, you approve", "request"],
    ["nobody new", "refuse"],
  ] as const)("when they answer '%s'", (_answer, policy) => {
    /** @scenario "Each answer says whether an arrival is provisioned" */
    it(`reads back as ${policy}, and is the only thing that does`, () => {
      const state = after(policy);

      expect(ssoArrivalPolicy(state)).toBe(policy);
      // One field, so the reader and the stored answer cannot be two
      // opinions. This is the whole of the fix.
      expect(state.arrivalPolicy).toBe(policy);
    });
  });

  describe("when the answer decides whether an arrival is provisioned", () => {
    /** @scenario "Each answer says whether an arrival is provisioned" */
    it("provisions for both admit and request, and for refuse alone does not", () => {
      // The regression that the two fields caused, stated as the rule rather
      // than as a second field: `request` PROVISIONS. The account is made and
      // a request to join stands beside it.
      expect(PROVISIONS.map((policy) => ssoArrivalPolicy(after(policy)))).toEqual([
        "admit",
        "request",
      ]);
      expect(ssoArrivalPolicy(after("refuse"))).toBe("refuse");
    });
  });

  describe("when nobody has answered yet", () => {
    it("is already on an answer, so no reader has to decide what absence means", () => {
      expect(ssoArrivalPolicy(blank())).toBe(DEFAULT_SSO_ARRIVAL_POLICY);
      // And the one it is on admits nobody, which is the only default that
      // cannot surprise an organization that has not been asked yet.
      expect(DEFAULT_SSO_ARRIVAL_POLICY).toBe("refuse");
    });
  });
});

/** The two answers that make a user. Named so the rule reads as a rule. */
const PROVISIONS = ["admit", "request"] as const;
