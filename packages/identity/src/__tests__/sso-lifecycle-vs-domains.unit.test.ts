import { describe, expect, it } from "vitest";
import {
  CONNECTION_ACTIVATED_EVENT_TYPE,
  CONNECTION_REGISTERED_EVENT_TYPE,
  DOMAIN_ATTESTED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_CLAIM_REJECTED_EVENT_TYPE,
  DOMAIN_VERIFIED_EVENT_TYPE,
  emptySsoConnection,
  reduceSsoConnection,
  routingStateOf,
  type SsoConnectionFact,
  type SsoConnectionState,
  VERIFICATION_REQUESTED_EVENT_TYPE,
} from "../index";

/**
 * A connection's LIFECYCLE and its DOMAINS are two different things.
 *
 * The lifecycle answers "is this door open"; a domain answers "who may come
 * through it". Only the lifecycle verbs — activate, suspend, tear down —
 * may move the first. Every domain fact folded its own lifecycle name in
 * unconditionally, so an administrator adding a second domain to a LIVE
 * connection folded `state: "CLAIMED"`, which `routingStateOf` reads as
 * INACTIVE: everybody already signing in on the first, proved domain stopped
 * being routed to their identity provider, mid-day, with nothing on any screen
 * saying so. Getting back required proving the new domain and activating
 * again.
 *
 * `stateAfterWithdrawal` already knew this — a domain LEAVING must not un-live
 * a connection. The cases below are the same sentence for the other direction,
 * asserted per fact rather than once, because the next domain fact somebody
 * adds is the one that will reach for the shorter spelling.
 */

const T0 = 1_756_000_000_000;
const ACTOR = { type: "user", id: "user_ana" } as const;
const CONNECTION = "ssoc_acme";

const fold = (state: SsoConnectionState, fact: SsoConnectionFact) =>
  reduceSsoConnection({ state, fact });

const fact = (type: string, data: Record<string, unknown>): SsoConnectionFact =>
  ({
    type,
    occurredAt: T0,
    data: { connectionId: CONNECTION, actor: ACTOR, ...data },
  }) as SsoConnectionFact;

/** A connection that has proved `acme.com` and is carrying live sign-ins. */
const liveConnection = (): SsoConnectionState => {
  const registered = fold(
    emptySsoConnection({ connectionId: CONNECTION }),
    fact(CONNECTION_REGISTERED_EVENT_TYPE, {
      organizationId: "org_acme",
      type: "oidc",
      idp: { issuer: "https://acme.okta.com", clientIdRef: null, secretRef: null, certRefs: [] },
      allowsJit: true,
      source: "self-serve",
    }),
  );
  const claimed = fold(registered, fact(DOMAIN_CLAIMED_EVENT_TYPE, { domain: "acme.com" }));
  const approved = fold(
    claimed,
    fact(DOMAIN_CLAIM_APPROVED_EVENT_TYPE, { domain: "acme.com", authority: "platform-operator" }),
  );
  const verified = fold(
    approved,
    fact(DOMAIN_VERIFIED_EVENT_TYPE, { domain: "acme.com", method: "dns-txt" }),
  );
  const active = fold(verified, fact(CONNECTION_ACTIVATED_EVENT_TYPE, {}));
  expect(active.state).toBe("ACTIVE");
  return active;
};

describe("given a connection that is already carrying sign-ins", () => {
  const secondDomainFacts: [string, SsoConnectionFact][] = [
    ["claimed", fact(DOMAIN_CLAIMED_EVENT_TYPE, { domain: "acme.co.uk" })],
    [
      "approved",
      fact(DOMAIN_CLAIM_APPROVED_EVENT_TYPE, {
        domain: "acme.co.uk",
        authority: "platform-operator",
      }),
    ],
    [
      "turned down",
      fact(DOMAIN_CLAIM_REJECTED_EVENT_TYPE, { domain: "acme.co.uk", note: "not yours" }),
    ],
    [
      "sent for verification",
      fact(VERIFICATION_REQUESTED_EVENT_TYPE, {
        domain: "acme.co.uk",
        method: "dns-txt",
        tokenHash: "hash",
        expiresAtMs: T0 + 86_400_000,
      }),
    ],
    ["attested", fact(DOMAIN_ATTESTED_EVENT_TYPE, { domain: "acme.co.uk" })],
    [
      "proved",
      fact(DOMAIN_VERIFIED_EVENT_TYPE, { domain: "acme.co.uk", method: "dns-txt" }),
    ],
  ];

  describe("when a second domain is added to it", () => {
    /** @scenario "Adding a domain never takes a live connection off the air" */
    it.each(secondDomainFacts)(
      "stays ACTIVE while the second domain is %s",
      (_step, secondDomainFact) => {
        const after = fold(liveConnection(), secondDomainFact);

        expect(after.state).toBe("ACTIVE");
        // The half a person actually feels: their sign-in still routes.
        expect(routingStateOf(after.state)).toBe("ACTIVE");
      },
    );

    it("still records the domain fact itself", () => {
      // The lifecycle is pinned; the domain work must not be pinned with it.
      const after = fold(
        liveConnection(),
        fact(DOMAIN_CLAIMED_EVENT_TYPE, { domain: "acme.co.uk" }),
      );

      expect(after.claimedDomains).toContain("acme.co.uk");
      expect(after.domainClaims.map((claim) => claim.domain)).toContain("acme.co.uk");
      // And the first domain keeps carrying the people already on it.
      expect(after.verifiedDomains).toEqual(["acme.com"]);
    });
  });
});

describe("given a connection that has not gone live yet", () => {
  describe("when a domain moves through its steps", () => {
    it("still lets each step name the lifecycle", () => {
      // The pin is only past VERIFIED. Before that the domain journey IS the
      // connection's journey, and a setup screen reads its progress from here.
      const draft = fold(
        emptySsoConnection({ connectionId: CONNECTION }),
        fact(CONNECTION_REGISTERED_EVENT_TYPE, {
          organizationId: "org_acme",
          type: "oidc",
          idp: { issuer: "https://acme.okta.com", clientIdRef: null, secretRef: null, certRefs: [] },
          allowsJit: true,
          source: "self-serve",
        }),
      );

      const claimed = fold(draft, fact(DOMAIN_CLAIMED_EVENT_TYPE, { domain: "acme.com" }));
      expect(claimed.state).toBe("CLAIMED");

      const approved = fold(
        claimed,
        fact(DOMAIN_CLAIM_APPROVED_EVENT_TYPE, {
          domain: "acme.com",
          authority: "platform-operator",
        }),
      );
      expect(approved.state).toBe("APPROVED");

      const verified = fold(
        approved,
        fact(DOMAIN_VERIFIED_EVENT_TYPE, { domain: "acme.com", method: "dns-txt" }),
      );
      expect(verified.state).toBe("VERIFIED");
    });
  });
});
