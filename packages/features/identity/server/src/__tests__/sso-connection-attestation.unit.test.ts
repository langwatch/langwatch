import {
  DOMAIN_ATTESTED_EVENT_TYPE,
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  emptySsoConnection,
  type SsoConnectionFactInput,
  type SsoConnectionState,
} from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it } from "vitest";
import { SsoConnectionGuards } from "../sso-connection-guards";
import {
  InMemoryConnections,
  StubBreakGlassBindings,
  StubPlatformOperators,
  StubStranding,
} from "./support/in-memory-connections";

/**
 * Operator attestation (D04's D05 amendment): a LangWatch operator states out
 * of band that a domain is an organization's, which replaces the PROOF and
 * never the approval.
 *
 * The distinction is the whole security argument, so it is what most of these
 * tests are about: the claim is still claimed, still approved by an operator,
 * and an attested domain is exactly as trustworthy as that approval — no
 * more. What is removed is the round-trip to a customer the same operator
 * just decided about, which buys latency and no security.
 */

const ORG = "org_acme";
const CONNECTION = "ssoc_1";
/** An administrator of "acme" holding every permission the organization can
 *  grant. She is still not a LangWatch operator, and that is the point. */
const ANA = { type: "user" as const, id: "user_ana" };
const OLIVE = { type: "user" as const, id: "user_olive" };
const T0 = 1_756_000_000_000;
const A_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const identity = {
  tenantId: ORG,
  organizationId: ORG,
  connectionId: CONNECTION,
  commandId: "ssocmd_1",
  occurredAtMs: T0,
  actor: ANA,
  source: "self-serve" as const,
};

const IDP = {
  issuer: "https://login.acme.okta.com",
  providerId: "okta",
  clientIdRef: "cred_client",
  secretRef: "cred_secret",
  certRefs: [],
};

let connections: InMemoryConnections;
let breakGlass: StubBreakGlassBindings;
let guards: SsoConnectionGuards;

async function run(
  verb: () => Promise<SsoConnectionFactInput[]>,
  { connectionId = CONNECTION, occurredAt = T0 } = {},
): Promise<{ facts: SsoConnectionFactInput[]; state: SsoConnectionState }> {
  const facts = await verb();
  const state = connections.apply({ connectionId, facts, occurredAt });
  return { facts, state };
}

/** Register and claim. Stops short of the approval, because whether the
 *  approval has happened is what half of these tests turn on. */
async function reachClaimed(): Promise<void> {
  await run(() =>
    guards.registerConnection({
      ...identity,
      type: "oidc",
      idp: IDP,
      allowsJit: true,
    }),
  );
  await run(() => guards.claimDomain({ ...identity, domain: "acme.com" }));
}

async function reachApproved(): Promise<void> {
  await reachClaimed();
  await run(() =>
    guards.approveDomainClaim({
      ...identity,
      actor: OLIVE,
      domain: "acme.com",
    }),
  );
}

beforeEach(() => {
  connections = new InMemoryConnections();
  breakGlass = new StubBreakGlassBindings(true);
  guards = new SsoConnectionGuards({
    connections,
    breakGlass,
    stranding: new StubStranding([]),
    platformOperators: new StubPlatformOperators([OLIVE.id]),
  });
});

describe("operator attestation", () => {
  describe("given an APPROVED connection for acme.com", () => {
    beforeEach(reachApproved);

    /** @scenario "An operator attests a domain instead of waiting for a record" */
    it("verifies the domain with nothing published, naming the operator and the time", async () => {
      const { facts, state } = await run(() =>
        guards.attestDomain({ ...identity, actor: OLIVE, domain: "acme.com" }),
      );

      expect(facts).toHaveLength(1);
      expect(facts[0]!.type).toBe(DOMAIN_ATTESTED_EVENT_TYPE);
      expect(facts[0]!.data).toMatchObject({
        connectionId: CONNECTION,
        domain: "acme.com",
        actor: OLIVE,
      });
      // Nothing was published, so nothing was hashed: an attestation carries
      // no token at all, which is why it is its own fact rather than a
      // verification_requested with a hole in it.
      expect(facts[0]!.data).not.toHaveProperty("tokenHash");

      expect(state.state).toBe("VERIFIED");
      expect(state.verifiedDomains).toEqual(["acme.com"]);
      // No ceremony was ever opened, so none is in flight.
      expect(state.pendingVerification).toBeNull();
      expect(state.domainVerifications).toEqual([
        {
          domain: "acme.com",
          method: "operator-attested",
          actorId: OLIVE.id,
          verifiedAtMs: T0,
        },
      ]);
    });

    /** @scenario "An organization administrator can never attest their own domain" */
    it("refuses an organization administrator and states no fact", async () => {
      await expect(
        guards.attestDomain({ ...identity, actor: ANA, domain: "acme.com" }),
      ).rejects.toMatchObject({
        code: "sso_connection_operator_act_required",
      });

      const held = await connections.findConnection({
        connectionId: CONNECTION,
      });
      expect(held?.state).toBe("APPROVED");
      expect(held?.verifiedDomains).toEqual([]);
      // Publishing the record stays the way her domain is proved, and it is
      // still available to her.
      const { state } = await run(() =>
        guards.requestVerification({
          ...identity,
          domain: "acme.com",
          method: "dns-txt",
          tokenHash: "sha256:proof",
        }),
      );
      expect(state.state).toBe("VERIFICATION_PENDING");
    });

    /** @scenario "Attestation is a platform operator's act on any deployment" */
    it("records a self-hosted installation's own operator, and still refuses its administrator", async () => {
      // Nothing about this guard asks which deployment it is on: a
      // self-hosted installation's platform operator is a platform operator,
      // and its organization administrator is not.
      const { facts, state } = await run(() =>
        guards.attestDomain({ ...identity, actor: OLIVE, domain: "acme.com" }),
      );
      expect(state.state).toBe("VERIFIED");
      expect(facts[0]!.data).toMatchObject({ actor: OLIVE });

      // The same installation, a second connection in the same organization,
      // approved and waiting to be proved. Its administrator still cannot
      // attest it — being self-hosted buys her nothing here.
      const second = { ...identity, connectionId: "ssoc_2" };
      await run(
        () =>
          guards.registerConnection({
            ...second,
            type: "oidc",
            idp: IDP,
            allowsJit: true,
          }),
        { connectionId: "ssoc_2" },
      );
      await run(
        () => guards.claimDomain({ ...second, domain: "other.example" }),
        { connectionId: "ssoc_2" },
      );
      await run(
        () =>
          guards.approveDomainClaim({
            ...second,
            actor: OLIVE,
            domain: "other.example",
          }),
        { connectionId: "ssoc_2" },
      );

      await expect(
        guards.attestDomain({
          ...second,
          actor: ANA,
          domain: "other.example",
        }),
      ).rejects.toMatchObject({
        code: "sso_connection_operator_act_required",
      });
    });

    /** @scenario "An attestation stands until somebody decides otherwise" */
    it("still verifies and still routes a year later, with nothing asking again", async () => {
      await run(() =>
        guards.attestDomain({ ...identity, actor: OLIVE, domain: "acme.com" }),
      );
      const { state } = await run(
        () =>
          guards.activateConnection({
            ...identity,
            actor: OLIVE,
            testLoginAccountId: "acc_test",
          }),
        { occurredAt: T0 },
      );
      expect(state.state).toBe("ACTIVE");

      // A year passes. Nothing in the aggregate is time-driven for a verified
      // domain: no deadline was written by the attestation, so none can
      // elapse, and reading the connection a year on answers exactly as it
      // did on the day.
      const aYearOn = await connections.findConnection({
        connectionId: CONNECTION,
      });
      expect(aYearOn?.state).toBe("ACTIVE");
      expect(aYearOn?.verifiedDomains).toEqual(["acme.com"]);
      expect(aYearOn?.tearDownAfterMs).toBeNull();
      expect(aYearOn?.pendingVerification).toBeNull();
      expect(aYearOn?.domainVerifications).toEqual([
        {
          domain: "acme.com",
          method: "operator-attested",
          actorId: OLIVE.id,
          verifiedAtMs: T0,
        },
      ]);

      // And it is still commandable as an ACTIVE connection at that later
      // instant — the attestation did not quietly stop being one.
      const later = await run(
        () =>
          guards.suspendConnection({
            ...identity,
            actor: OLIVE,
            reason: null,
          }),
        { occurredAt: T0 + A_YEAR_MS },
      );
      expect(later.state.state).toBe("SUSPENDED");
    });

    /** @scenario "A disputed attested domain is answered by suspending, not by expiring" */
    it("stops routing the moment an operator suspends, with the whole story readable", async () => {
      const attested = await run(() =>
        guards.attestDomain({ ...identity, actor: OLIVE, domain: "acme.com" }),
      );
      await run(() =>
        guards.activateConnection({
          ...identity,
          actor: OLIVE,
          testLoginAccountId: "acc_test",
        }),
      );

      const suspended = await run(
        () =>
          guards.suspendConnection({
            ...identity,
            actor: OLIVE,
            reason: "domain ownership disputed by the registrant",
          }),
        { occurredAt: T0 + A_YEAR_MS },
      );

      expect(suspended.state.state).toBe("SUSPENDED");
      // The domain is still recorded as verified — suspension stops the
      // connection routing rather than un-proving anything, which is what
      // makes it reversible.
      expect(suspended.state.verifiedDomains).toEqual(["acme.com"]);

      // The attestation, the dispute and the suspension are all readable: who
      // attested it and when, and the reason the suspension carries.
      expect(attested.facts[0]!.data).toMatchObject({
        domain: "acme.com",
        actor: OLIVE,
      });
      expect(suspended.facts[0]!.data).toMatchObject({
        reason: "domain ownership disputed by the registrant",
        actor: OLIVE,
      });
      expect(suspended.state.domainVerifications).toEqual([
        {
          domain: "acme.com",
          method: "operator-attested",
          actorId: OLIVE.id,
          verifiedAtMs: T0,
        },
      ]);
    });
  });

  describe("given a CLAIMED connection that nobody has approved", () => {
    beforeEach(reachClaimed);

    /** @scenario "Attestation replaces the proof and never the approval" */
    it("refuses the attestation, states no fact, and admits it once the claim is approved", async () => {
      await expect(
        guards.attestDomain({ ...identity, actor: OLIVE, domain: "acme.com" }),
      ).rejects.toMatchObject({
        code: "sso_connection_invalid_transition",
      });

      const held = await connections.findConnection({
        connectionId: CONNECTION,
      });
      expect(held?.state).toBe("CLAIMED");
      expect(held?.verifiedDomains).toEqual([]);
      expect(held?.domainVerifications).toEqual([]);

      // Attesting becomes available only once the claim is approved — which
      // is the trust decision the attestation rests on, and never replaces.
      await run(() =>
        guards.approveDomainClaim({
          ...identity,
          actor: OLIVE,
          domain: "acme.com",
        }),
      );
      const { state } = await run(() =>
        guards.attestDomain({ ...identity, actor: OLIVE, domain: "acme.com" }),
      );
      expect(state.state).toBe("VERIFIED");
    });
  });

  describe("given acme.com is verified on another organization's ACTIVE connection", () => {
    beforeEach(async () => {
      connections.seed({
        ...emptySsoConnection({ connectionId: "ssoc_first" }),
        organizationId: "org_first",
        state: "ACTIVE",
        verifiedDomains: ["acme.com"],
        domainVerifications: [
          {
            domain: "acme.com",
            method: "dns-txt",
            actorId: "user_first",
            verifiedAtMs: T0,
          },
        ],
      });
      await reachApproved();
    });

    /** @scenario "An attested domain cannot take one another ACTIVE connection holds" */
    it("refuses the attestation exactly as any other method is refused", async () => {
      await expect(
        guards.attestDomain({ ...identity, actor: OLIVE, domain: "acme.com" }),
      ).rejects.toMatchObject({ code: "sso_connection_domain_taken" });

      // The same code the DNS ceremony is refused with, from the same check:
      // an operator's word does not outrank first-verifier-owns.
      await expect(
        guards.requestVerification({
          ...identity,
          domain: "acme.com",
          method: "dns-txt",
          tokenHash: "sha256:proof",
        }),
      ).rejects.toMatchObject({ code: "sso_connection_domain_taken" });

      const held = await connections.findConnection({
        connectionId: CONNECTION,
      });
      expect(held?.state).toBe("APPROVED");
      expect(held?.verifiedDomains).toEqual([]);
      expect(await connections.findDomainOwner({ domain: "acme.com" })).toEqual(
        { connectionId: "ssoc_first", organizationId: "org_first" },
      );
    });
  });

  describe("given one domain proved by a published record and another attested", () => {
    /** @scenario "How a domain was proved is its own recorded method, permanently" */
    /** @scenario "Which tier a connection came through stays readable afterwards" */
    it("names each domain's method and who authorized it, on the connection itself", async () => {
      await reachApproved();
      await run(() =>
        guards.attestDomain({ ...identity, actor: OLIVE, domain: "acme.com" }),
      );

      // A second connection, whose domain the customer proved themselves.
      const proved = { ...identity, connectionId: "ssoc_2" };
      await run(
        () =>
          guards.registerConnection({
            ...proved,
            type: "oidc",
            idp: IDP,
            allowsJit: true,
          }),
        { connectionId: "ssoc_2" },
      );
      await run(() => guards.claimDomain({ ...proved, domain: "beta.example" }), {
        connectionId: "ssoc_2",
      });
      await run(
        () =>
          guards.approveDomainClaim({
            ...proved,
            actor: OLIVE,
            domain: "beta.example",
          }),
        { connectionId: "ssoc_2" },
      );
      await run(
        () =>
          guards.requestVerification({
            ...proved,
            domain: "beta.example",
            method: "dns-txt",
            tokenHash: "sha256:proof",
          }),
        { connectionId: "ssoc_2" },
      );
      await run(
        () => guards.verifyDomain({ ...proved, domain: "beta.example" }),
        { connectionId: "ssoc_2" },
      );

      // A third, on a self-hosted installation whose licence proved it.
      const licensed = { ...identity, connectionId: "ssoc_3" };
      await run(
        () =>
          guards.registerConnection({
            ...licensed,
            type: "oidc",
            idp: IDP,
            allowsJit: true,
          }),
        { connectionId: "ssoc_3" },
      );
      await run(
        () => guards.claimDomain({ ...licensed, domain: "gamma.example" }),
        { connectionId: "ssoc_3" },
      );
      await run(
        () =>
          guards.approveDomainClaim({
            ...licensed,
            actor: OLIVE,
            domain: "gamma.example",
          }),
        { connectionId: "ssoc_3" },
      );
      await run(
        () =>
          guards.requestVerification({
            ...licensed,
            domain: "gamma.example",
            method: "license-token",
            tokenHash: "sha256:licence",
          }),
        { connectionId: "ssoc_3" },
      );
      await run(
        () => guards.verifyDomain({ ...licensed, domain: "gamma.example" }),
        { connectionId: "ssoc_3" },
      );

      const attested = await connections.findConnection({
        connectionId: CONNECTION,
      });
      const published = await connections.findConnection({
        connectionId: "ssoc_2",
      });
      const byLicence = await connections.findConnection({
        connectionId: "ssoc_3",
      });

      // Each domain names the method that proved it, and who — so a dispute
      // is answerable from the connection alone.
      expect(attested?.domainVerifications).toEqual([
        {
          domain: "acme.com",
          method: "operator-attested",
          actorId: OLIVE.id,
          verifiedAtMs: T0,
        },
      ]);
      expect(published?.domainVerifications).toEqual([
        {
          domain: "beta.example",
          method: "dns-txt",
          actorId: ANA.id,
          verifiedAtMs: T0,
        },
      ]);
      expect(byLicence?.domainVerifications).toEqual([
        {
          domain: "gamma.example",
          method: "license-token",
          actorId: ANA.id,
          verifiedAtMs: T0,
        },
      ]);

      // And nothing anywhere can present the attested one as customer-proved:
      // the method is a distinct value, not an absence to be defaulted.
      expect(
        attested?.domainVerifications.map((entry) => entry.method),
      ).not.toContain("dns-txt");
    });
  });

  describe("when the operator who claimed a domain approves it themselves", () => {
    /** @scenario "The operator approving the claim they just made is recorded as exactly that" */
    it("records both facts naming that operator, and implies no second reviewer", async () => {
      await run(() =>
        guards.registerConnection({
          ...identity,
          actor: OLIVE,
          type: "oidc",
          idp: IDP,
          allowsJit: true,
        }),
      );
      const claimed = await run(() =>
        guards.claimDomain({ ...identity, actor: OLIVE, domain: "acme.com" }),
      );
      const approved = await run(() =>
        guards.approveDomainClaim({
          ...identity,
          actor: OLIVE,
          domain: "acme.com",
        }),
      );

      // Two separate facts, in order, each naming Olive. The history says one
      // person did both, which is what happened.
      expect(claimed.facts).toHaveLength(1);
      expect(claimed.facts[0]!.type).toBe(DOMAIN_CLAIMED_EVENT_TYPE);
      expect(claimed.facts[0]!.data).toMatchObject({ actor: OLIVE });
      expect(approved.facts).toHaveLength(1);
      expect(approved.facts[0]!.type).toBe(DOMAIN_CLAIM_APPROVED_EVENT_TYPE);
      expect(approved.facts[0]!.data).toMatchObject({ actor: OLIVE });

      // Nothing carries a reviewer distinct from the actor, so nothing on the
      // connection can be read as a second person having looked.
      expect(approved.facts[0]!.data).not.toHaveProperty("reviewer");
      expect(approved.facts[0]!.data).not.toHaveProperty("reviewedBy");
      expect(approved.state.state).toBe("APPROVED");
    });

    /** @scenario "Approving somebody else's domain claim is an operator's act, not an administrator's" */
    it("refuses an organization administrator approving their own organization's claim", async () => {
      await reachClaimed();

      await expect(
        guards.approveDomainClaim({
          ...identity,
          actor: ANA,
          domain: "acme.com",
        }),
      ).rejects.toMatchObject({
        code: "sso_connection_operator_act_required",
      });

      const held = await connections.findConnection({
        connectionId: CONNECTION,
      });
      expect(held?.state).toBe("CLAIMED");
      expect(held?.approvedDomains).toEqual([]);

      // Approving stays available to a LangWatch operator, and only to one.
      const { state } = await run(() =>
        guards.approveDomainClaim({
          ...identity,
          actor: OLIVE,
          domain: "acme.com",
        }),
      );
      expect(state.state).toBe("APPROVED");
    });
  });
});
