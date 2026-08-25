import { describe, expect, it } from "vitest";
import {
  CONNECTION_REGISTERED_EVENT_TYPE,
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  DOMAIN_VERIFIED_EVENT_TYPE,
  emptySsoConnection,
  reduceSsoConnection,
  type SsoConnectionFactInput,
  type SsoConnectionState,
  VERIFICATION_REQUESTED_EVENT_TYPE,
  verificationHasExpired,
} from "../connection";
import {
  SSO_DNS_PROOF_TTL_MS,
  SSO_DNS_RECORD_NAME,
  SSO_DNS_RECORD_TYPE,
  ssoDnsRecordName,
} from "../self-serve-onboarding";

/**
 * The DNS ceremony's vocabulary, and what an expiry does to a domain that
 * was already proved (specs/identity/sso-domain-verification.feature).
 *
 * Pure: no resolver, no service, no ledger. What is under test is where the
 * record lives and what the fold says afterwards, which is the part every
 * other layer has to agree with.
 */

const CONNECTION = "ssoc_acme";
const ORG = "org_acme";
const ACTOR = { type: "user" as const, id: "user_ana" };
const T0 = 1_756_000_000_000;

function fold(facts: SsoConnectionFactInput[]): SsoConnectionState {
  let state = emptySsoConnection({ connectionId: CONNECTION });
  for (const fact of facts) {
    state = reduceSsoConnection({ state, fact: { ...fact, occurredAt: T0 } });
  }
  return state;
}

describe("given the record a customer is asked to publish", () => {
  describe("when the name for a domain is composed", () => {
    /** @scenario "The record names itself completely, so nothing has to be guessed" */
    it("puts the label exactly one level under the domain, and asks for a TXT record", () => {
      const domain = "acme.com";
      const name = ssoDnsRecordName({ domain });

      // Under the customer's own domain, one level down, so a control panel
      // that wants a relative name can take the label verbatim.
      expect(name.endsWith(`.${domain}`)).toBe(true);
      expect(name.slice(0, -`.${domain}`.length)).toBe(SSO_DNS_RECORD_NAME);
      expect(name.split(".")).toHaveLength(domain.split(".").length + 1);

      // An underscore label, which no hostname may be, so the verification
      // name cannot collide with anything the customer serves.
      expect(name.startsWith("_")).toBe(true);
      expect(SSO_DNS_RECORD_TYPE).toBe("TXT");
    });

    /** @scenario "The record names itself completely, so nothing has to be guessed" */
    it("keeps the same one label for a subdomain and for every organization", () => {
      const forApex = ssoDnsRecordName({ domain: "acme.com" });
      const forSubdomain = ssoDnsRecordName({ domain: "eu.acme.com" });
      const forSomebodyElse = ssoDnsRecordName({ domain: "olive.example" });

      const labelOf = (name: string) => name.split(".")[0];
      expect(labelOf(forSubdomain)).toBe(labelOf(forApex));
      expect(labelOf(forSomebodyElse)).toBe(labelOf(forApex));
      // Nothing organization-specific reaches the public name: the value is
      // the secret, and a per-organization label would publish who we are
      // talking to.
      expect(forApex).not.toContain(ORG);
    });
  });
});

describe("given a domain that was proved by a published record", () => {
  const proved = () =>
    fold([
      {
        type: CONNECTION_REGISTERED_EVENT_TYPE,
        data: {
          connectionId: CONNECTION,
          organizationId: ORG,
          type: "oidc",
          idp: {
            issuer: null,
            providerId: "okta",
            clientIdRef: null,
            secretRef: null,
            certRefs: [],
          },
          allowsJit: false,
          actor: ACTOR,
          source: "self-serve",
        },
      },
      {
        type: DOMAIN_CLAIMED_EVENT_TYPE,
        data: {
          connectionId: CONNECTION,
          domain: "acme.com",
          actor: ACTOR,
          source: "self-serve",
        },
      },
      {
        type: DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
        data: {
          connectionId: CONNECTION,
          domain: "acme.com",
          actor: ACTOR,
          authority: "platform-operator",
          source: "self-serve",
        },
      },
      {
        type: VERIFICATION_REQUESTED_EVENT_TYPE,
        data: {
          connectionId: CONNECTION,
          domain: "acme.com",
          method: "dns-txt",
          tokenHash: "sha256:whatever",
          expiresAtMs: T0 + SSO_DNS_PROOF_TTL_MS,
          actor: ACTOR,
          source: "self-serve",
        },
      },
      {
        type: DOMAIN_VERIFIED_EVENT_TYPE,
        data: {
          connectionId: CONNECTION,
          domain: "acme.com",
          method: "dns-txt",
          actor: ACTOR,
          source: "self-serve",
        },
      },
    ]);

  describe("when the ceremony's expiry passes long afterwards", () => {
    /** @scenario "Nothing schedules a re-check, and an expiry never un-proves a domain" */
    it("leaves the domain proved, with no ceremony left for an expiry to read", () => {
      const state = proved();
      const aYearLater = T0 + 365 * 24 * 60 * 60 * 1000;

      expect(state.verifiedDomains).toEqual(["acme.com"]);
      // Proving it CLEARED the ceremony, so there is nothing an expiry could
      // apply to — which is why no scheduled re-check exists and no domain
      // silently stops routing.
      expect(state.pendingVerification).toBeNull();
      expect(
        verificationHasExpired({
          pending: state.pendingVerification,
          nowMs: aYearLater,
        }),
      ).toBe(false);

      // The fold at that later moment says the same thing: a proved domain
      // leaves the set only when a human suspends or tears the connection
      // down.
      expect(fold([]).verifiedDomains).toEqual([]);
      expect(proved().verifiedDomains).toEqual(["acme.com"]);
    });
  });
});
