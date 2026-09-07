import { describe, expect, it } from "vitest";
import {
  assertsSecondFactor,
  connectionAssertsSecondFactor,
  isMfaChallengeMethod,
  MFA_CHALLENGE_METHODS,
  PASSWORD_AMR,
  PHISHING_RESISTANT_AMR,
  recordedNothing,
  satisfiesOrganizationMfaRequirement,
  secondFactorsIn,
  signInProvedSecondFactor,
} from "../mfa-condition";

/** A sign-in that proved nothing beyond a password. */
const PASSWORD_ONLY = [PASSWORD_AMR];
/** A sign-in that used a passkey. */
const PASSKEY = [PHISHING_RESISTANT_AMR];

function reach({
  mfaRequired = true,
  accountEnrollmentEnabled = false,
  amr = null,
}: {
  mfaRequired?: boolean;
  accountEnrollmentEnabled?: boolean;
  amr?: readonly string[] | null;
}) {
  return satisfiesOrganizationMfaRequirement({
    mfaRequired,
    evidence: { accountEnrollmentEnabled, amr },
  });
}

describe("an organization's second-factor membership condition", () => {
  describe("given the organization does not require one", () => {
    it("lets everybody through whatever they proved", () => {
      expect(reach({ mfaRequired: false, amr: null }).satisfied).toBe(true);
      expect(reach({ mfaRequired: false, amr: PASSWORD_ONLY }).by).toBe(
        "not_required",
      );
    });
  });

  describe("given the person set one up on their own account", () => {
    /** @scenario "Someone who has set it up answers a challenge every time" */
    it("is satisfied by the account alone, without consulting the sign-in", () => {
      // An account with two-step verification enabled is challenged at EVERY
      // sign-in, so the account answer is the durable one and the session's
      // own evidence cannot add to it or take away from it.
      for (const amr of [null, [], PASSWORD_ONLY, PASSKEY]) {
        const decision = reach({ accountEnrollmentEnabled: true, amr });
        expect(decision.satisfied).toBe(true);
        expect(decision.by).toBe("account_enrollment");
      }
    });

    /** @scenario "A session that never answered a challenge cannot exist for them" */
    it("offers no outcome that would ask an existing session to step up", () => {
      // There is no "verified a while ago" and no "verify again now": the
      // condition either holds or holds the person at an enrollment gate.
      // A step-up outcome would need somewhere to live, and there is
      // nowhere — which is what keeps sessions out of this decision.
      const outcomes = new Set(
        [
          reach({ accountEnrollmentEnabled: true, amr: null }),
          reach({ accountEnrollmentEnabled: false, amr: PASSKEY }),
          reach({ accountEnrollmentEnabled: false, amr: PASSWORD_ONLY }),
          reach({ mfaRequired: false, amr: null }),
        ].map((decision) => decision.by),
      );

      expect([...outcomes].sort()).toEqual([
        "account_enrollment",
        "none",
        "not_required",
        "sign_in",
      ]);
    });
  });

  describe("given the sign-in came through an identity provider", () => {
    /** @scenario "A provider that asserted a second factor satisfies the requirement" */
    it("takes the provider's assertion as the second factor", () => {
      const decision = reach({ amr: ["pwd", "otp"] });

      expect(decision.satisfied).toBe(true);
      expect(decision.by).toBe("sign_in");
      expect(decision).toMatchObject({ factors: ["otp"] });
    });

    /** @scenario "A provider that asserts nothing satisfies nothing" */
    it("infers no factor the provider did not assert", () => {
      // `saml` and `oidc` name a protocol, not a proof. A federated sign-in
      // is not a second factor just because it went through somebody else.
      for (const amr of [["saml"], ["oidc"], ["pwd", "saml"], [], null]) {
        const decision = reach({ amr });
        expect(decision.satisfied).toBe(false);
        expect(decision.by).toBe("none");
      }

      expect(assertsSecondFactor("saml")).toBe(false);
      expect(assertsSecondFactor("pwd")).toBe(false);
      // An unrecognized value from an unknown provider asserts nothing.
      expect(assertsSecondFactor("something-new")).toBe(false);
      expect(connectionAssertsSecondFactor(["saml"])).toBe(false);
      expect(connectionAssertsSecondFactor(["saml", "mfa"])).toBe(true);
    });
  });

  describe("given the person signed in with a passkey", () => {
    /** @scenario "A passkey satisfies an organization's two-step requirement" */
    it("lets a passkey sign-in through with no enrollment at all", () => {
      const decision = reach({ accountEnrollmentEnabled: false, amr: PASSKEY });

      expect(decision.satisfied).toBe(true);
      expect(decision.by).toBe("sign_in");
      expect(decision).toMatchObject({ factors: [PHISHING_RESISTANT_AMR] });
    });

    /** @scenario "A passkey held on the person's own devices satisfies it the same way" */
    it("does not care whether the passkey syncs or stays on one device", () => {
      // Where the credential lives is the authenticator's business. What the
      // sign-in proved is the same either way, so the condition reads the
      // same `amr` and reaches the same answer.
      const synced = reach({ amr: PASSKEY });
      const deviceBound = reach({ amr: [PHISHING_RESISTANT_AMR, "hwk"] });

      expect(synced.satisfied).toBe(true);
      expect(deviceBound.satisfied).toBe(true);
      expect(deviceBound.by).toBe(synced.by);
    });

    /** @scenario "Holding a passkey does not carry over to a password sign-in" */
    it("holds the same person at the gate when they sign in with a password", () => {
      // Registering a passkey is not an account-level enrollment, so the
      // evidence is per sign-in. The passkey session goes through and the
      // password session does not.
      expect(reach({ amr: PASSKEY }).satisfied).toBe(true);
      expect(reach({ amr: PASSWORD_ONLY }).satisfied).toBe(false);
      expect(signInProvedSecondFactor(PASSKEY)).toBe(true);
      expect(signInProvedSecondFactor(PASSWORD_ONLY)).toBe(false);
    });

    /** @scenario "A passkey is never asked for as a second step" */
    it("keeps a passkey out of what a challenge may ask for", () => {
      // A passkey is a way IN, not a second step. Offering it on the
      // challenge screen would be offering the first factor twice.
      expect(isMfaChallengeMethod(PHISHING_RESISTANT_AMR)).toBe(false);
      expect(isMfaChallengeMethod("passkey")).toBe(false);
      expect(MFA_CHALLENGE_METHODS.every(isMfaChallengeMethod)).toBe(true);
      expect(
        MFA_CHALLENGE_METHODS.some((method) => assertsSecondFactor(method)),
      ).toBe(false);
    });
  });

  describe("given a session minted before any of this existed", () => {
    it("treats a null record as having proved nothing, and ends no session", () => {
      // Every session that predates D06 has no `amr` at all. It is an
      // ordinary value here, not an error: such a person meets the gate
      // where a requirement applies and is untouched everywhere else.
      expect(recordedNothing(null)).toBe(true);
      expect(recordedNothing([])).toBe(true);
      expect(recordedNothing(PASSWORD_ONLY)).toBe(false);
      expect(reach({ mfaRequired: false, amr: null }).satisfied).toBe(true);
    });

    it("reports the recognized factors in order, without repeating one", () => {
      expect(secondFactorsIn(["pwd", "otp", "otp", "phw"])).toEqual([
        "otp",
        "phw",
      ]);
      expect(secondFactorsIn(null)).toEqual([]);
    });
  });
});
