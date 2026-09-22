/**
 * @vitest-environment node
 * How far one organization's cutover has come, read fresh: who is linked to
 * the replacement, how quiet the old connection has gone, and what still
 * stands between here and retiring it.
 * @see specs/identity/sso-connection-lifecycle.feature
 */
import {
  emptySsoConnection,
  type BreakGlassBinding,
  type IdentifierFact,
  type SsoConnectionState,
} from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { MemoryIdentityStore } from "../../repositories/memory/memory-identity.store.ts";
import { MemoryIdentityRepositories } from "../../repositories/memory/memory.identity.repositories.ts";
import {
  SsoMigrationProgressService,
  type SsoMigrationMember,
} from "../sso-migration-progress.service.ts";

const ORG = "org_acme";
const LEGACY = "ssoc_legacy";
const REPLACEMENT = "ssoc_replacement";
const NOW = 1_756_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const ANA: SsoMigrationMember = { userId: "user_ana", name: "Ana", email: "ana@acme.com" };
const BEN: SsoMigrationMember = { userId: "user_ben", name: "Ben", email: "ben@acme.com" };

function legacy(over: Partial<SsoConnectionState> = {}): SsoConnectionState {
  return {
    ...emptySsoConnection({ connectionId: LEGACY }),
    organizationId: ORG,
    state: "ACTIVE",
    source: "legacy-grandfathered",
    verifiedDomains: ["acme.com"],
    idpMetadata: {
      issuer: null,
      providerId: "auth0",
      clientIdRef: null,
      secretRef: null,
      certRefs: [],
    },
    createdAtMs: NOW - 30 * DAY_MS,
    ...over,
  };
}

function replacement(over: Partial<SsoConnectionState> = {}): SsoConnectionState {
  return {
    ...emptySsoConnection({ connectionId: REPLACEMENT }),
    organizationId: ORG,
    state: "ACTIVE",
    source: "self-serve",
    replacesConnectionId: LEGACY,
    migrationPhase: "GRACE_DIRECT",
    routeChangedAtMs: NOW - 10 * DAY_MS,
    graceStartedAtMs: NOW - 10 * DAY_MS,
    verifiedDomains: ["acme.com"],
    domainVerifications: [
      {
        domain: "acme.com",
        method: "dns-txt",
        actorId: "user_ana",
        verifiedAtMs: NOW - 11 * DAY_MS,
        proofState: "VERIFIED",
        firstAbsentAtMs: null,
        graceEndsAtMs: null,
        tokenHash: "sha256:proof",
      },
    ],
    testLoginAccountId: "acct_ana",
    idpMetadata: {
      issuer: "https://acme.okta.com",
      providerId: "acme-okta",
      clientIdRef: "cred_1",
      secretRef: "cred_2",
      certRefs: [],
    },
    createdAtMs: NOW - 20 * DAY_MS,
    ...over,
  };
}

function identifier(over: Partial<IdentifierFact> & { identifierId: string }): IdentifierFact {
  return {
    userId: ANA.userId,
    provider: "oidc",
    value: "ana@acme.com",
    domain: "acme.com",
    identifierHash: null,
    accountId: null,
    providerId: null,
    issuer: null,
    providerAccountId: null,
    connectionId: null,
    state: "VERIFIED",
    verifiedAtMs: NOW - 5 * DAY_MS,
    attachedAtMs: NOW - 5 * DAY_MS,
    detachedAtMs: null,
    ...over,
  };
}

const liveBinding: BreakGlassBinding = {
  bindingId: "bg_1",
  organizationId: ORG,
  userId: ANA.userId,
  grantedByUserId: "user_ops",
  grantedAtMs: NOW - DAY_MS,
  expiresAtMs: NOW + 30 * DAY_MS,
  supersededAtMs: null,
  renewedFromBindingId: null,
  warnedDays: [],
};

function scenario({
  connections = [legacy(), replacement()],
  identifiers = [identifier({ identifierId: "idf_ana", connectionId: REPLACEMENT })],
  members = [ANA],
  bindings = [liveBinding],
  authentications = [],
}: {
  connections?: SsoConnectionState[];
  identifiers?: IdentifierFact[];
  members?: SsoMigrationMember[];
  bindings?: BreakGlassBinding[];
  authentications?: {
    providerAccountId?: string | null;
    organizationId: string;
    connectionId: string;
    userId: string;
    authenticatedAtMs: number;
  }[];
} = {}) {
  const store = MemoryIdentityStore.create();
  for (const connection of connections)
    store.ssoConnections.set(connection.connectionId, connection);
  for (const fact of identifiers) store.identifiers.set(fact.identifierId, fact);
  for (const binding of bindings) store.breakGlassBindings.set(binding.bindingId, binding);
  for (const record of authentications) {
    store.ssoAuthentications.push({ providerAccountId: null, ...record });
  }
  const repositories = MemoryIdentityRepositories.over(store);

  return SsoMigrationProgressService.create({
    connections: repositories.ssoConnections,
    evidence: repositories.ssoMigrationEvidence,
    breakGlass: repositories.ssoBreakGlass,
    memberships: { listActiveMembers: async () => members },
    now: () => NOW,
  });
}

const progress = async (service: SsoMigrationProgressService) =>
  (await service.getProgress({ organizationId: ORG, cursor: null, limit: 25 })).migration;

describe("given an organization running no migration", () => {
  it("has no cutover to report", async () => {
    await expect(progress(scenario({ connections: [legacy()] }))).resolves.toBeNull();
  });

  it("ignores a replacement that was abandoned", async () => {
    const service = scenario({
      connections: [legacy(), replacement({ state: "DISCARDED" })],
    });

    await expect(progress(service)).resolves.toBeNull();
  });
});

describe("given a replacement registered beside the grandfathered connection", () => {
  it("names both halves, the phase and the route the phase decides", async () => {
    const view = await progress(scenario());

    expect(view?.legacy).toEqual({
      connectionId: LEGACY,
      source: "legacy-grandfathered",
      providerId: "auth0",
    });
    expect(view?.replacement.providerId).toBe("acme-okta");
    expect(view?.phase).toBe("GRACE_DIRECT");
    expect(view?.selectedRoute).toBe("direct");
  });

  it("carries the domains it inherited, with what they were proved against", async () => {
    const view = await progress(scenario());

    expect(view?.inheritedDomains).toEqual([
      {
        domain: "acme.com",
        method: "dns-txt",
        proofState: "VERIFIED",
        evidenceRef: "sha256:proof",
        verifiedAtMs: NOW - 11 * DAY_MS,
      },
    ]);
  });

  it("counts a member linked by an identifier the replacement issued", async () => {
    const view = await progress(scenario({ members: [ANA, BEN] }));

    expect(view?.members.activeCount).toBe(2);
    expect(view?.members.linkedCount).toBe(1);
    expect(view?.members.stragglers).toEqual([
      {
        userId: BEN.userId,
        name: "Ben",
        email: "ben@acme.com",
        lastLegacyAuthenticationAtMs: null,
      },
    ]);
  });

  it("says when each straggler last came in through the old connection", async () => {
    const view = await progress(
      scenario({
        members: [BEN],
        identifiers: [],
        authentications: [
          {
            organizationId: ORG,
            connectionId: LEGACY,
            userId: BEN.userId,
            authenticatedAtMs: NOW - 2 * DAY_MS,
          },
        ],
      }),
    );

    expect(view?.members.stragglers[0]?.lastLegacyAuthenticationAtMs).toBe(NOW - 2 * DAY_MS);
  });

  /** @scenario "Migration progress recognizes native identifiers without connection annotations" */
  it("counts an adopted identifier that names the replacement's own provider", async () => {
    const view = await progress(
      scenario({
        identifiers: [
          identifier({
            identifierId: "idf_native",
            connectionId: null,
            providerId: REPLACEMENT,
            providerAccountId: "sub_ana",
          }),
        ],
      }),
    );

    expect(view?.members.linkedCount).toBe(1);
    expect(view?.members.stragglers).toEqual([]);
  });

  /** @scenario "Migration progress recognizes native identifiers without connection annotations" */
  it("never overrides an explicit association to another connection", async () => {
    const view = await progress(
      scenario({
        identifiers: [
          identifier({
            identifierId: "idf_elsewhere",
            connectionId: "ssoc_elsewhere",
            providerId: REPLACEMENT,
            providerAccountId: "sub_ana",
          }),
        ],
      }),
    );

    expect(view?.members.linkedCount).toBe(0);
  });

  it("hands back a cursor only while another page follows", async () => {
    const service = scenario({ members: [ANA, BEN], identifiers: [] });

    const { migration } = await service.getProgress({
      organizationId: ORG,
      cursor: null,
      limit: 1,
    });

    expect(migration?.members.stragglers).toHaveLength(1);
    expect(migration?.members.nextCursor).toBe(ANA.userId);
  });
});

describe("given a cutover that is nearly done", () => {
  it("lets it finalize once nothing is left to wait for", async () => {
    const view = await progress(scenario());

    expect(view?.blockers).toEqual([]);
    expect(view?.canFinalize).toBe(true);
    expect(view?.quietPeriod.complete).toBe(true);
  });

  it("refuses while somebody signed in through the old connection this week", async () => {
    const view = await progress(
      scenario({
        authentications: [
          {
            organizationId: ORG,
            connectionId: LEGACY,
            userId: ANA.userId,
            authenticatedAtMs: NOW - DAY_MS,
          },
        ],
      }),
    );

    expect(view?.blockers.map((blocker) => blocker.code)).toContain("legacy-activity-not-quiet");
    expect(view?.quietPeriod.lastLegacyAuthenticationAtMs).toBe(NOW - DAY_MS);
    expect(view?.canFinalize).toBe(false);
  });

  it("refuses while the old connection still decides sign-ins", async () => {
    const view = await progress(
      scenario({ connections: [legacy(), replacement({ migrationPhase: "GRACE_LEGACY" })] }),
    );

    expect(view?.blockers.map((blocker) => blocker.code)).toContain("direct-route-not-selected");
    expect(view?.canFinalize).toBe(false);
  });

  it("refuses while nobody holds a way back in", async () => {
    const view = await progress(scenario({ bindings: [] }));

    expect(view?.blockers.map((blocker) => blocker.code)).toContain("recovery-path-missing");
  });

  it("refuses while a member holds no identifier on the replacement", async () => {
    const view = await progress(scenario({ members: [ANA, BEN] }));

    expect(view?.blockers.map((blocker) => blocker.code)).toContain("members-not-linked");
  });

  it("says nothing about directory provisioning this installation does not run", async () => {
    const view = await progress(scenario());

    expect(view?.scim.status).toBe("not-applicable");
  });
});
