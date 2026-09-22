/**
 * @vitest-environment node
 * Where a setup journey stands, read off what identity folded: what is
 * claimed, what is proved, and what still stands between here and live.
 */
import {
  emptySsoConnection,
  type BreakGlassBinding,
  type SsoConnectionState,
  type SsoDomainVerification,
} from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { MemoryIdentityStore } from "../../repositories/memory/memory-identity.store.ts";
import { MemoryIdentityRepositories } from "../../repositories/memory/memory.identity.repositories.ts";
import { SsoMigrationProgressService } from "../sso-migration-progress.service.ts";
import { SsoSetupService } from "../sso-setup.service.ts";

const ORG = "org_acme";
const NOW = 1_756_000_000_000;
const CONNECTION_ID = "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m";

const DNS_PROOF: SsoDomainVerification = {
  domain: "acme.com",
  method: "dns-txt",
  actorId: "user_ana",
  verifiedAtMs: NOW - 1_000,
  proofState: "VERIFIED",
  firstAbsentAtMs: null,
  graceEndsAtMs: null,
  tokenHash: "sha256:proof",
};

function connection(over: Partial<SsoConnectionState> = {}): SsoConnectionState {
  return {
    ...emptySsoConnection({ connectionId: CONNECTION_ID }),
    organizationId: ORG,
    state: "VERIFIED",
    source: "self-serve",
    createdBy: "user_ana",
    createdAtMs: NOW - 10_000,
    idpMetadata: {
      issuer: "https://idp.example",
      providerId: "acme-okta",
      clientIdRef: null,
      secretRef: null,
      certRefs: [],
    },
    ...over,
  };
}

function binding(over: Partial<BreakGlassBinding> = {}): BreakGlassBinding {
  return {
    bindingId: "bg_1",
    organizationId: ORG,
    userId: "user_ana",
    grantedByUserId: "user_ops",
    grantedAtMs: NOW - 5_000,
    expiresAtMs: NOW + 5_000,
    supersededAtMs: null,
    renewedFromBindingId: null,
    warnedDays: [],
    ...over,
  };
}

function scenario(
  rows: SsoConnectionState[],
  bindings: BreakGlassBinding[] = [],
  authentications: {
    connectionId: string;
    userId: string;
    authenticatedAtMs: number;
    providerAccountId?: string | null;
  }[] = [],
) {
  const store = MemoryIdentityStore.create();
  for (const record of authentications) {
    store.ssoAuthentications.push({
      organizationId: ORG,
      providerAccountId: null,
      ...record,
    });
  }
  for (const row of rows) store.ssoConnections.set(row.connectionId, row);
  for (const held of bindings) store.breakGlassBindings.set(held.bindingId, held);
  const repositories = MemoryIdentityRepositories.over(store);

  return SsoSetupService.create({
    connections: repositories.ssoConnections,
    breakGlass: repositories.ssoBreakGlass,
    activity: repositories.ssoMigrationEvidence,
    migrations: SsoMigrationProgressService.create({
      connections: repositories.ssoConnections,
      evidence: repositories.ssoMigrationEvidence,
      breakGlass: repositories.ssoBreakGlass,
      memberships: { listActiveMembers: async () => [] },
      now: () => NOW,
    }),
    now: () => NOW,
  });
}

describe("given an organization that has registered nothing", () => {
  it("has no connection, nothing to prove and nothing to take live", async () => {
    await expect(scenario([]).getSetup({ organizationId: ORG })).resolves.toEqual({
      connection: null,
      claims: [],
      record: null,
      goLive: null,
      legacyRoute: null,
      migration: null,
    });
  });
});

describe("given a connection part-way through its setup", () => {
  it("names what it is, and what each domain is worth", async () => {
    const service = scenario([
      connection({
        verifiedDomains: ["acme.com"],
        domainVerifications: [DNS_PROOF],
        claimedDomains: ["acme.io"],
      }),
    ]);

    const view = await service.getSetup({ organizationId: ORG });

    expect(view.connection).toMatchObject({
      connectionId: CONNECTION_ID,
      state: "VERIFIED",
      providerId: "acme-okta",
      issuer: "https://idp.example",
      verifiedDomains: ["acme.com"],
    });
    expect(view.connection?.domainProofs).toEqual([
      {
        domain: "acme.com",
        method: "dns-txt",
        qualification: "QUALIFIED",
        proofState: "VERIFIED",
        graceEndsAtMs: null,
        verifiedAtMs: DNS_PROOF.verifiedAtMs,
        verifier: { type: "user", id: "user_ana" },
      },
    ]);
    expect(view.claims).toEqual([
      { domain: "acme.io", state: "CLAIMED", note: null, waitsForReview: true },
    ]);
  });

  it("carries a rejection's own words, so a re-claim starts from them", async () => {
    const service = scenario([
      connection({ rejection: { domain: "acme.net", note: "that domain is somebody else's" } }),
    ]);

    await expect(service.getSetup({ organizationId: ORG })).resolves.toMatchObject({
      claims: [
        {
          domain: "acme.net",
          state: "REJECTED",
          note: "that domain is somebody else's",
          waitsForReview: false,
        },
      ],
    });
  });

  it("shows the ceremony in flight without ever showing what it published", async () => {
    const service = scenario([
      connection({
        state: "VERIFICATION_PENDING",
        pendingVerification: {
          domain: "acme.com",
          method: "dns-txt",
          tokenHash: "sha256:secret",
          expiresAtMs: NOW - 1,
        },
      }),
    ]);

    const view = await service.getSetup({ organizationId: ORG });

    expect(view.record).toEqual({
      domain: "acme.com",
      method: "dns-txt",
      expiresAtMs: NOW - 1,
      expired: true,
    });
    expect(JSON.stringify(view)).not.toContain("secret");
  });
});

describe("given a connection waiting to go live", () => {
  it("holds it back until every precondition is met", async () => {
    const service = scenario([
      connection({ verifiedDomains: ["acme.com"], domainVerifications: [DNS_PROOF] }),
    ]);

    await expect(service.getSetup({ organizationId: ORG })).resolves.toMatchObject({
      goLive: {
        domainProved: true,
        testSignIn: { done: false },
        breakGlass: { inPlace: false, liveCount: 0 },
        arrivalsDecided: false,
        ready: false,
        activated: false,
      },
    });
  });

  it("is ready once the domain is proved, somebody came back in, a way in is held and arrivals are decided", async () => {
    const service = scenario(
      [
        connection({
          verifiedDomains: ["acme.com"],
          domainVerifications: [DNS_PROOF],
          testLoginAccountId: "acc_test",
          arrivalPolicy: "admit",
          arrivalPolicyDecidedAtMs: NOW - 100,
        }),
      ],
      [binding()],
    );

    await expect(service.getSetup({ organizationId: ORG })).resolves.toMatchObject({
      goLive: { ready: true, breakGlass: { inPlace: true, liveCount: 1 }, activated: false },
    });
  });

  it("counts a sign-in the connection itself decided as the test sign-in", async () => {
    const service = scenario(
      [connection({ verifiedDomains: ["acme.com"], domainVerifications: [DNS_PROOF] })],
      [],
      [{ connectionId: CONNECTION_ID, userId: "user_ana", authenticatedAtMs: NOW - 60_000 }],
    );

    await expect(service.getSetup({ organizationId: ORG })).resolves.toMatchObject({
      goLive: { testSignIn: { done: true } },
    });
  });

  it("counts no way back in that has expired or been replaced", async () => {
    const service = scenario(
      [connection({ verifiedDomains: ["acme.com"], domainVerifications: [DNS_PROOF] })],
      [
        binding({ bindingId: "bg_old", expiresAtMs: NOW - 1 }),
        binding({ bindingId: "bg_superseded", supersededAtMs: NOW - 10 }),
      ],
    );

    await expect(service.getSetup({ organizationId: ORG })).resolves.toMatchObject({
      goLive: { breakGlass: { inPlace: false, liveCount: 0 } },
    });
  });
});

describe("given a legacy route beside a connection being set up", () => {
  it("names the route still deciding sign-ins, and shows the new connection as the setup", async () => {
    const legacy = connection({
      connectionId: "local_ssoc_legacy",
      state: "ACTIVE",
      source: "legacy-grandfathered",
      createdAtMs: NOW - 100_000,
      verifiedDomains: ["acme.com"],
      idpMetadata: {
        issuer: null,
        providerId: "okta-legacy",
        clientIdRef: null,
        secretRef: null,
        certRefs: [],
      },
    });
    const service = scenario([legacy, connection()]);

    const view = await service.getSetup({ organizationId: ORG });

    expect(view.connection?.connectionId).toBe(CONNECTION_ID);
    expect(view.legacyRoute).toEqual({
      connectionId: legacy.connectionId,
      domain: "acme.com",
      provider: "okta-legacy",
    });
  });

  it("shows the legacy route itself when it is all the organization holds", async () => {
    const legacy = connection({
      state: "ACTIVE",
      source: "legacy-grandfathered",
      verifiedDomains: ["acme.com"],
      idpMetadata: {
        issuer: null,
        providerId: "okta-legacy",
        clientIdRef: null,
        secretRef: null,
        certRefs: [],
      },
    });

    const view = await scenario([legacy]).getSetup({ organizationId: ORG });

    expect(view.connection?.connectionId).toBe(CONNECTION_ID);
    expect(view.legacyRoute).toEqual({
      connectionId: legacy.connectionId,
      domain: "acme.com",
      provider: "okta-legacy",
    });
  });
});

describe("given a connection nobody can carry further", () => {
  it("is not the setup: a discarded connection leaves the journey at the start", async () => {
    const view = await scenario([connection({ state: "DISCARDED" })]).getSetup({
      organizationId: ORG,
    });

    expect(view.connection).toBeNull();
    expect(view.goLive).toBeNull();
  });
});
