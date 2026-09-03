import {
  CONNECTION_ACTIVATED_EVENT_TYPE,
  CONNECTION_REGISTERED_EVENT_TYPE,
  DOMAIN_CLAIM_APPROVED_EVENT_TYPE,
  DOMAIN_CLAIM_REJECTED_EVENT_TYPE,
  DOMAIN_CLAIMED_EVENT_TYPE,
  DOMAIN_VERIFIED_EVENT_TYPE,
  emptySsoConnection,
  type SsoConnectionFactInput,
  type SsoConnectionState,
  VERIFICATION_REQUESTED_EVENT_TYPE,
} from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it } from "vitest";
import { SsoConnectionGuards } from "../sso-connection-guards";
import {
  InMemoryConnections,
  StubBreakGlassBindings,
  StubPlatformOperators,
  StubStranding,
} from "./support/in-memory-connections";

const ORG = "org_acme";
const CONNECTION = "ssoc_1";
const ANA = { type: "user" as const, id: "user_ana" };
const OPS = { type: "user" as const, id: "user_ops" };
const T0 = 1_756_000_000_000;

const identity = {
  tenantId: ORG,
  organizationId: ORG,
  connectionId: CONNECTION,
  // Carried because the command shape carries it; the guards never read it —
  // it is what the LEDGER keys idempotency on, one layer up.
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
let stranding: StubStranding;
let guards: SsoConnectionGuards;

/** Run a verb and fold what it states, the way the pipeline does. */
async function run(
  verb: () => Promise<SsoConnectionFactInput[]>,
  connectionId = CONNECTION,
): Promise<{ facts: SsoConnectionFactInput[]; state: SsoConnectionState }> {
  const facts = await verb();
  const state = connections.apply({
    connectionId,
    facts,
    occurredAt: T0,
  });
  return { facts, state };
}

async function reachVerified(): Promise<void> {
  await run(() =>
    guards.registerConnection({ ...identity, type: "oidc", idp: IDP, allowsJit: true }),
  );
  await run(() => guards.claimDomain({ ...identity, domain: "acme.com" }));
  await run(() => guards.approveDomainClaim({ ...identity, actor: OPS, domain: "acme.com" }));
  await run(() =>
    guards.requestVerification({
      ...identity,
      domain: "acme.com",
      method: "dns-txt",
      tokenHash: "sha256:proof",
    }),
  );
  await run(() => guards.verifyDomain({ ...identity, domain: "acme.com" }));
}

async function reachActive(): Promise<void> {
  await reachVerified();
  await run(() => guards.activateConnection({ ...identity, testLoginAccountId: "acc_test" }));
}

beforeEach(() => {
  connections = new InMemoryConnections();
  breakGlass = new StubBreakGlassBindings(true);
  stranding = new StubStranding([]);
  guards = new SsoConnectionGuards({
    connections,
    breakGlass,
    stranding,
    platformOperators: new StubPlatformOperators([OPS.id]),
  });
});

describe("sso connection guards", () => {
  describe("given an organization with no connection yet", () => {
    /** @scenario "Registering a connection starts a DRAFT with history" */
    it("states a registration and folds to DRAFT without a secret", async () => {
      const { facts, state } = await run(() =>
        guards.registerConnection({
          ...identity,
          type: "oidc",
          idp: IDP,
          allowsJit: true,
        }),
      );

      expect(facts).toHaveLength(1);
      expect(facts[0]!.type).toBe(CONNECTION_REGISTERED_EVENT_TYPE);
      expect(state.state).toBe("DRAFT");
      expect(state.organizationId).toBe(ORG);
      // The fact names credential RECORDS, never their values. Serializing
      // the whole payload is what makes this a leak test rather than a
      // field-by-field spot check that a new field could slip past.
      const payload = JSON.stringify(facts[0]!.data);
      expect(payload).toContain("cred_client");
      expect(payload).toContain("cred_secret");
      expect(payload).not.toContain("secret-value");
      expect(facts[0]!.data).toMatchObject({
        idp: { clientIdRef: "cred_client", secretRef: "cred_secret" },
      });
    });
  });

  describe("given a DRAFT connection", () => {
    beforeEach(async () => {
      await run(() =>
        guards.registerConnection({
          ...identity,
          type: "oidc",
          idp: IDP,
          allowsJit: true,
        }),
      );
    });

    /** @scenario "A claimed domain waits for ops approval" */
    it("records the claim and routes nothing until ops approves", async () => {
      const { facts, state } = await run(() =>
        guards.claimDomain({ ...identity, domain: "Acme.com" }),
      );

      expect(facts[0]!.type).toBe(DOMAIN_CLAIMED_EVENT_TYPE);
      expect(facts[0]!.data).toMatchObject({
        domain: "acme.com",
        actor: ANA,
      });
      expect(state.state).toBe("CLAIMED");
      expect(state.claimedDomains).toEqual(["acme.com"]);
      // Nothing routes: routing reads verified domains on an ACTIVE
      // connection, and a claim is neither.
      expect(state.verifiedDomains).toEqual([]);
      expect(await connections.findDomainOwner({ domain: "acme.com" })).toBeNull();
    });
  });

  describe("given a CLAIMED connection", () => {
    beforeEach(async () => {
      await run(() =>
        guards.registerConnection({
          ...identity,
          type: "oidc",
          idp: IDP,
          allowsJit: true,
        }),
      );
      await run(() => guards.claimDomain({ ...identity, domain: "acme.com" }));
    });

    /** @scenario "Ops approval and rejection are both recorded and recoverable" */
    it("puts the approver on the event", async () => {
      const { facts, state } = await run(() =>
        guards.approveDomainClaim({
          ...identity,
          actor: OPS,
          domain: "acme.com",
        }),
      );

      expect(facts[0]!.type).toBe(DOMAIN_CLAIM_APPROVED_EVENT_TYPE);
      expect(facts[0]!.data).toMatchObject({ actor: OPS });
      expect(state.state).toBe("APPROVED");
      expect(state.approvedDomains).toEqual(["acme.com"]);
    });

    /** @scenario "Ops approval and rejection are both recorded and recoverable" */
    it("records a rejection's note and leaves the domain re-claimable", async () => {
      const rejected = await run(() =>
        guards.rejectDomainClaim({
          ...identity,
          actor: OPS,
          domain: "acme.com",
          note: "Could not reach the listed domain owner",
        }),
      );

      expect(rejected.facts[0]!.type).toBe(DOMAIN_CLAIM_REJECTED_EVENT_TYPE);
      expect(rejected.state.state).toBe("REJECTED");
      expect(rejected.state.rejection).toEqual({
        domain: "acme.com",
        note: "Could not reach the listed domain owner",
      });

      const reclaimed = await run(() => guards.claimDomain({ ...identity, domain: "acme.com" }));
      expect(reclaimed.facts).toHaveLength(1);
      expect(reclaimed.state.state).toBe("CLAIMED");
    });
  });

  describe("given an APPROVED connection", () => {
    beforeEach(async () => {
      await run(() =>
        guards.registerConnection({
          ...identity,
          type: "oidc",
          idp: IDP,
          allowsJit: true,
        }),
      );
      await run(() => guards.claimDomain({ ...identity, domain: "acme.com" }));
      await run(() =>
        guards.approveDomainClaim({
          ...identity,
          actor: OPS,
          domain: "acme.com",
        }),
      );
    });

    /** @scenario "Domain verification stores the proof's hash, never the token" */
    it("carries the token's hash and verifies when the record is found", async () => {
      const requested = await run(() =>
        guards.requestVerification({
          ...identity,
          domain: "acme.com",
          method: "dns-txt",
          tokenHash: "sha256:9f86d0",
        }),
      );

      expect(requested.facts[0]!.type).toBe(VERIFICATION_REQUESTED_EVENT_TYPE);
      expect(requested.facts[0]!.data).toMatchObject({
        tokenHash: "sha256:9f86d0",
        method: "dns-txt",
      });
      // The command boundary never sees a token at all, so no fact can carry
      // one: the only field for it is the hash.
      expect(JSON.stringify(requested.facts[0]!.data)).not.toContain("lw-verify-");
      expect(requested.state.state).toBe("VERIFICATION_PENDING");
      expect(requested.state.pendingVerification).toEqual({
        domain: "acme.com",
        method: "dns-txt",
        tokenHash: "sha256:9f86d0",
      });

      const verified = await run(() => guards.verifyDomain({ ...identity, domain: "acme.com" }));
      expect(verified.facts[0]!.type).toBe(DOMAIN_VERIFIED_EVENT_TYPE);
      expect(verified.state.state).toBe("VERIFIED");
      expect(verified.state.verifiedDomains).toEqual(["acme.com"]);
      expect(verified.state.pendingVerification).toBeNull();
    });
  });

  describe("given another organization's ACTIVE connection owns the domain", () => {
    beforeEach(async () => {
      connections.seed({
        ...emptySsoConnection({ connectionId: "ssoc_first" }),
        organizationId: "org_first",
        state: "ACTIVE",
        verifiedDomains: ["acme.com"],
      });
      await run(() =>
        guards.registerConnection({
          ...identity,
          type: "oidc",
          idp: IDP,
          allowsJit: true,
        }),
      );
      await run(() => guards.claimDomain({ ...identity, domain: "acme.com" }));
      await run(() =>
        guards.approveDomainClaim({
          ...identity,
          actor: OPS,
          domain: "acme.com",
        }),
      );
    });

    /** @scenario "A domain owned by another ACTIVE connection cannot be verified" */
    it("refuses the ceremony and leaves the first verifier holding the domain", async () => {
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
      // No event: the refusal happens before any fact exists, so the claimant
      // is left exactly where it was.
      expect(held?.state).toBe("APPROVED");
      expect(held?.verifiedDomains).toEqual([]);
      expect(await connections.findDomainOwner({ domain: "acme.com" })).toEqual({
        connectionId: "ssoc_first",
        organizationId: "org_first",
      });
    });
  });

  describe("given a VERIFIED connection", () => {
    beforeEach(reachVerified);

    /** @scenario "Activation requires a verified domain and a live break-glass binding" */
    it("refuses without a live break-glass binding and succeeds with one", async () => {
      breakGlass.set(false);
      await expect(
        guards.activateConnection({
          ...identity,
          testLoginAccountId: "acc_test",
        }),
      ).rejects.toMatchObject({ code: "sso_connection_activation_blocked" });
      expect((await connections.findConnection({ connectionId: CONNECTION }))?.state).toBe(
        "VERIFIED",
      );

      breakGlass.set(true);
      const { facts, state } = await run(() =>
        guards.activateConnection({
          ...identity,
          testLoginAccountId: "acc_test",
        }),
      );
      expect(facts[0]!.type).toBe(CONNECTION_ACTIVATED_EVENT_TYPE);
      expect(state.state).toBe("ACTIVE");
      expect(state.testLoginAccountId).toBe("acc_test");
    });

    /** @scenario "Activation requires a verified domain and a live break-glass binding" */
    it("refuses without a recorded test login even when a binding is live", async () => {
      await expect(
        guards.activateConnection({ ...identity, testLoginAccountId: null }),
      ).rejects.toMatchObject({ code: "sso_connection_activation_blocked" });
    });
  });

  describe("given an ACTIVE connection", () => {
    beforeEach(reachActive);

    /** @scenario "Suspension is always available and reversible" */
    it("suspends, stops routing its domains, and resumes", async () => {
      const suspended = await run(() =>
        guards.suspendConnection({ ...identity, reason: "IdP maintenance" }),
      );
      expect(suspended.state.state).toBe("SUSPENDED");
      // Stops routing: ownership is scoped to ACTIVE, so a suspended
      // connection's domains answer nobody.
      expect(await connections.findDomainOwner({ domain: "acme.com" })).toBeNull();

      const resumed = await run(() => guards.resumeConnection({ ...identity }));
      expect(resumed.state.state).toBe("ACTIVE");
      expect(await connections.findDomainOwner({ domain: "acme.com" })).toEqual({
        connectionId: CONNECTION,
        organizationId: ORG,
      });
    });

    /** @scenario "Teardown never strands a user" */
    it("refuses while a user holds no other verified method, then proceeds", async () => {
      stranding.set(["user_sam", "user_lee"]);
      await expect(
        guards.requestTeardown({
          ...identity,
          reason: null,
          graceMs: 1_000,
        }),
      ).rejects.toMatchObject({
        code: "sso_connection_teardown_strands_users",
      });
      expect((await connections.findConnection({ connectionId: CONNECTION }))?.state).toBe(
        "ACTIVE",
      );

      stranding.set([]);
      const { state } = await run(() =>
        guards.requestTeardown({
          ...identity,
          reason: null,
          graceMs: 1_000,
        }),
      );
      expect(state.state).toBe("TEARDOWN_PENDING");
      expect(state.tearDownAfterMs).toBe(T0 + 1_000);
    });
  });

  describe("given a TEARDOWN_PENDING connection", () => {
    beforeEach(async () => {
      await reachActive();
      await run(() => guards.requestTeardown({ ...identity, reason: null, graceMs: 1_000 }));
    });

    /** @scenario "Teardown completes only after its grace period" */
    it("refuses completion before the grace elapses", async () => {
      await expect(
        guards.completeTeardown({ ...identity, occurredAtMs: T0 + 500 }),
      ).rejects.toMatchObject({ code: "sso_connection_invalid_transition" });
    });

    /** @scenario "Teardown completes only after its grace period" */
    it("completes once it has, and the domains route nowhere", async () => {
      const { state } = await run(() =>
        guards.completeTeardown({ ...identity, occurredAtMs: T0 + 1_000 }),
      );
      expect(state.state).toBe("TORN_DOWN");
      expect(await connections.findDomainOwner({ domain: "acme.com" })).toBeNull();
    });
  });

  describe("given a grandfathered ACTIVE connection", () => {
    beforeEach(async () => {
      await run(() =>
        guards.grandfatherConnection({
          ...identity,
          actor: { type: "system", id: null },
          source: "legacy-grandfathered",
          type: "oidc",
          idp: IDP,
          allowsJit: true,
          domains: ["acme.com"],
        }),
      );
    });

    /** @scenario "Grandfathered state never weakens a live guard" */
    it("applies the same guards a self-served connection gets", async () => {
      const held = await connections.findConnection({
        connectionId: CONNECTION,
      });
      expect(held?.state).toBe("ACTIVE");
      expect(held?.source).toBe("legacy-grandfathered");

      // Suspend it, then try to bring it back with no break-glass binding:
      // the activation-shaped guard is not what resume runs, so the honest
      // check is the one a grandfathered connection would actually hit.
      await run(() => guards.suspendConnection({ ...identity, reason: null }));
      stranding.set(["user_sam"]);
      await run(() => guards.resumeConnection({ ...identity }));
      await expect(
        guards.requestTeardown({ ...identity, reason: null, graceMs: 1 }),
      ).rejects.toMatchObject({
        code: "sso_connection_teardown_strands_users",
      });
    });

    /** @scenario "Grandfathered state never weakens a live guard" */
    it("refuses a re-activation with no live break-glass binding", async () => {
      // Reaching VERIFIED again is what a re-configured connection does, and
      // from there activation is the guarded verb — which reads the SAME
      // break-glass port for a grandfathered connection as for any other.
      connections.seed({
        ...emptySsoConnection({ connectionId: CONNECTION }),
        organizationId: ORG,
        source: "legacy-grandfathered",
        state: "VERIFIED",
        verifiedDomains: ["acme.com"],
      });
      breakGlass.set(false);

      await expect(
        guards.activateConnection({
          ...identity,
          source: "legacy-grandfathered",
          testLoginAccountId: "acc_test",
        }),
      ).rejects.toMatchObject({ code: "sso_connection_activation_blocked" });
    });
  });

  describe("given a connection that was already grandfathered", () => {
    /** @scenario "The grandfather migration is idempotent per organization" */
    it("states nothing on a second pass and leaves exactly one connection", async () => {
      const grandfather = () =>
        guards.grandfatherConnection({
          ...identity,
          actor: { type: "system", id: null },
          source: "legacy-grandfathered" as const,
          type: "oidc" as const,
          idp: IDP,
          allowsJit: true,
          domains: ["acme.com"],
        });

      const first = await run(grandfather);
      expect(first.facts.length).toBeGreaterThan(0);

      const second = await grandfather();
      expect(second).toEqual([]);

      const held = await connections.findConnection({
        connectionId: CONNECTION,
      });
      expect(held?.state).toBe("ACTIVE");
      expect(held?.verifiedDomains).toEqual(["acme.com"]);
    });
  });
});
