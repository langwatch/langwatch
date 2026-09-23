/**
 * @vitest-environment node
 * What retiring a grandfathered connection does to the identifiers it minted:
 * everybody keeps a proved way in, a provider another organization still runs
 * is left alone, and the accounts go through the module that owns them.
 * @see specs/identity/sso-connection-lifecycle.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  emptySsoConnection,
  type IdentifierFact,
  type SsoConnectionState,
} from "@langwatch/identity-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryIdentityRepositories } from "../../repositories/memory/memory.identity.repositories.ts";
import { MemoryIdentityStore } from "../../repositories/memory/memory.identity.store.ts";
import type { IdentityService } from "../identity.service.ts";
import { SsoLegacyIdentityRetirementService } from "../sso-legacy-identity-retirement.service.ts";

const ORG = "org_acme";
const OTHER_ORG = "org_globex";
const LEGACY = "ssoc_legacy";
const REPLACEMENT = "ssoc_replacement";
const NOW = 1_756_000_000_000;
const ANA = "user_ana";

function legacy(over: Partial<SsoConnectionState> = {}): SsoConnectionState {
  return {
    ...emptySsoConnection({ connectionId: LEGACY }),
    organizationId: ORG,
    state: "ACTIVE",
    source: "legacy-grandfathered",
    idpMetadata: {
      issuer: null,
      providerId: "waad|acme",
      clientIdRef: null,
      secretRef: null,
      certRefs: [],
    },
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
    idpMetadata: {
      issuer: "https://acme.okta.com",
      providerId: "acme-okta",
      clientIdRef: null,
      secretRef: null,
      certRefs: [],
    },
    ...over,
  };
}

function identifier(over: Partial<IdentifierFact> & { identifierId: string }): IdentifierFact {
  return {
    userId: ANA,
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
    verifiedAtMs: NOW - 1000,
    attachedAtMs: NOW - 1000,
    detachedAtMs: null,
    ...over,
  };
}

const legacyHolding = identifier({
  identifierId: "idf_legacy",
  connectionId: LEGACY,
  state: "PRIMARY",
});
const replacementHolding = identifier({
  identifierId: "idf_replacement",
  connectionId: REPLACEMENT,
});

function scenario({
  connections = [legacy(), replacement()],
  identifiers = [legacyHolding, replacementHolding],
  otherOrganizations = [],
  otherOrganizationConnections = [],
}: {
  connections?: SsoConnectionState[];
  identifiers?: IdentifierFact[];
  /** The other organizations this person belongs to. */
  otherOrganizations?: string[];
  /** What those organizations have registered. */
  otherOrganizationConnections?: SsoConnectionState[];
} = {}) {
  const store = MemoryIdentityStore.create();
  for (const connection of [...connections, ...otherOrganizationConnections]) {
    store.ssoConnections.set(connection.connectionId, connection);
  }
  for (const fact of identifiers) store.identifiers.set(fact.identifierId, fact);
  const repositories = MemoryIdentityRepositories.over(store);
  const detachIdentifier = vi.fn(async () => []);
  const markPrimary = vi.fn(async () => []);
  const retire = vi.fn(async () => ({ retired: 1, remaining: 0 }));

  const service = SsoLegacyIdentityRetirementService.create({
    identity: createApiFixture<IdentityService>({ detachIdentifier, markPrimary }),
    connections: repositories.ssoConnections,
    evidence: repositories.ssoMigrationEvidence,
    memberships: {
      listActiveMembers: async () => [{ userId: ANA, name: "Ana", email: "ana@acme.com" }],
      organizationIdsForMember: async () => [ORG, ...otherOrganizations],
    },
    legacyAccess: { count: async () => 0, retire },
    now: () => NOW,
  });

  return { service, detachIdentifier, markPrimary, retire };
}

const request = {
  organizationId: ORG,
  legacyConnectionId: LEGACY,
  replacementConnectionId: REPLACEMENT,
  actorUserId: "user_admin",
};

describe("retiring the identities a grandfathered connection minted", () => {
  it("detaches the legacy identifier and asks the account owner to sweep the rest", async () => {
    const { service, detachIdentifier, retire } = scenario();

    await service.retire(request);

    expect(detachIdentifier).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ANA, identifierId: "idf_legacy" }),
    );
    expect(retire).toHaveBeenCalledWith({ organizationId: ORG, connectionId: LEGACY });
  });

  it("hands primary to the replacement before the legacy one goes", async () => {
    const { service, markPrimary } = scenario();

    await service.retire(request);

    expect(markPrimary).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ANA, identifierId: "idf_replacement" }),
    );
  });

  it("refuses when somebody holds no proved identifier on the replacement", async () => {
    const { service, detachIdentifier } = scenario({ identifiers: [legacyHolding] });

    await expect(service.retire(request)).rejects.toMatchObject({
      code: "sso_migration_finalization_blocked",
    });
    expect(detachIdentifier).not.toHaveBeenCalled();
  });

  it("refuses when the same legacy provider still runs for another organization", async () => {
    const { service, retire } = scenario({
      otherOrganizations: [OTHER_ORG],
      otherOrganizationConnections: [
        legacy({ connectionId: "ssoc_globex", organizationId: OTHER_ORG }),
      ],
    });

    await expect(service.retire(request)).rejects.toMatchObject({
      code: "sso_migration_finalization_blocked",
    });
    expect(retire).not.toHaveBeenCalled();
  });

  it("refuses a connection that is not the organization's grandfathered one", async () => {
    const { service } = scenario({
      connections: [legacy({ source: "self-serve" }), replacement()],
    });

    await expect(service.retire(request)).rejects.toMatchObject({
      code: "sso_migration_finalization_blocked",
    });
  });

  it("has nothing left to detach on a second pass", async () => {
    const { service, detachIdentifier, retire } = scenario({ identifiers: [replacementHolding] });

    await service.retire(request);

    expect(detachIdentifier).not.toHaveBeenCalled();
    expect(retire).toHaveBeenCalledTimes(1);
  });
});
