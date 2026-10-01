/**
 * The memory stranding twin answers what the Postgres one does
 * (prisma.sso-connection-stranding.repository.integration.test.ts, case for case).
 */
import {
  emptySsoConnection,
  type IdentifierFact,
  type IdentifierLifecycleState,
  type IdentifierProvider,
  type SsoConnectionLifecycleState,
  SsoConnectionNotFoundError,
} from "@langwatch/identity-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { newSsoConnectionId } from "../../../rules/sso-connection-id.rules.ts";
import { MemoryIdentityStore } from "../memory.identity.store.ts";
import { MemorySsoConnectionStrandingRepository } from "../memory.sso-connection.repositories.ts";

const organizationId = "org";
const otherOrganizationId = "other-org";
const connectionId = "connection";
const otherConnectionId = "other-connection";
const memberId = "member";
const unrelatedId = "unrelated";

let store: MemoryIdentityStore;
let repository: MemorySsoConnectionStrandingRepository;
let next = 0;

function storedConnection(
  id: string,
  owner: string,
  state: SsoConnectionLifecycleState,
  overrides: { source?: "self-serve" | "legacy-grandfathered"; providerId?: string } = {},
) {
  const empty = emptySsoConnection({ connectionId: id });
  store.ssoConnections.set(id, {
    ...empty,
    organizationId: owner,
    state,
    source: overrides.source ?? "self-serve",
    idpMetadata: { ...empty.idpMetadata, providerId: overrides.providerId ?? "oidc" },
  });
}

function identifier({
  userId = memberId,
  provider = "oidc",
  state = "VERIFIED",
  boundConnectionId = connectionId,
  providerId = connectionId,
  providerAccountId = `subject-${(next += 1)}`,
}: {
  userId?: string;
  provider?: IdentifierProvider;
  state?: IdentifierLifecycleState;
  boundConnectionId?: string | null;
  providerId?: string | null;
  providerAccountId?: string | null;
} = {}) {
  const identifierId = `identifier-${(next += 1)}`;
  const fact: IdentifierFact = {
    identifierId,
    userId,
    provider,
    value: null,
    domain: null,
    identifierHash: null,
    accountId: null,
    providerId,
    issuer: providerId,
    providerAccountId,
    connectionId: boundConnectionId,
    state,
    verifiedAtMs: state === "VERIFIED" || state === "PRIMARY" ? 1 : null,
    attachedAtMs: 1,
    detachedAtMs: null,
  };
  store.identifiers.set(identifierId, fact);
}

beforeEach(() => {
  store = MemoryIdentityStore.create();
  repository = MemorySsoConnectionStrandingRepository.create(store);
  store.organizationMembers.set(organizationId, [memberId]);
  store.organizationMembers.set(otherOrganizationId, [unrelatedId]);
  storedConnection(connectionId, organizationId, "ACTIVE");
});

describe("MemorySsoConnectionStrandingRepository", () => {
  it("refuses to assess a connection whose projection is unavailable", async () => {
    identifier();
    store.ssoConnections.delete(connectionId);

    await expect(repository.findStrandedUserIds({ connectionId })).rejects.toBeInstanceOf(
      SsoConnectionNotFoundError,
    );
  });

  it("finds the native provider binding alongside its unverified address", async () => {
    identifier({ boundConnectionId: null });
    identifier({
      provider: "email",
      state: "ATTACHED",
      boundConnectionId: null,
      providerId: null,
      providerAccountId: null,
    });

    expect(await repository.findStrandedUserIds({ connectionId })).toEqual([memberId]);
  });

  it("counts a local credential whose connection annotation is null", async () => {
    identifier();
    identifier({ provider: "credential", boundConnectionId: null, providerId: "credential" });

    expect(await repository.findStrandedUserIds({ connectionId })).toEqual([]);
  });

  it.each([
    { provider: "email", state: "ATTACHED" },
    { provider: "email", state: "VERIFIED" },
    { provider: "email", state: "PRIMARY" },
    { provider: "credential", state: "ATTACHED" },
    { provider: "oidc", state: "ATTACHED" },
    { provider: "passkey", state: "DEAD_END" },
    { provider: "passkey", state: "DETACHED" },
  ] satisfies { provider: IdentifierProvider; state: IdentifierLifecycleState }[])(
    "rejects $state $provider as a fallback",
    async ({ provider, state }) => {
      identifier();
      identifier({
        provider,
        state,
        boundConnectionId: otherConnectionId,
        providerId: otherConnectionId,
      });

      expect(await repository.findStrandedUserIds({ connectionId })).toEqual([memberId]);
    },
  );

  it.each([
    { provider: "passkey", state: "VERIFIED", providerId: null, boundConnectionId: null },
    { provider: "google", state: "VERIFIED", providerId: "google", boundConnectionId: null },
    { provider: "oidc", state: "PRIMARY", providerId: otherConnectionId, boundConnectionId: null },
    {
      provider: "oidc",
      state: "VERIFIED",
      providerId: otherConnectionId,
      boundConnectionId: otherConnectionId,
    },
  ] satisfies {
    provider: IdentifierProvider;
    state: IdentifierLifecycleState;
    providerId: string | null;
    boundConnectionId: string | null;
  }[])("accepts $state $provider outside the removed connection", async (alternative) => {
    storedConnection(otherConnectionId, otherOrganizationId, "ACTIVE");
    identifier({ boundConnectionId: null });
    identifier(alternative);

    expect(await repository.findStrandedUserIds({ connectionId })).toEqual([]);
  });

  it("keeps a user stranded when both representations name the removed provider", async () => {
    storedConnection(otherConnectionId, otherOrganizationId, "ACTIVE");
    identifier();
    identifier({ boundConnectionId: null });
    identifier({ boundConnectionId: otherConnectionId });

    expect(await repository.findStrandedUserIds({ connectionId })).toEqual([memberId]);
  });

  it.each(
    (["SUSPENDED", "TEARDOWN_PENDING", "TORN_DOWN", "DRAFT"] as const).flatMap((state) => [
      { state, boundConnectionId: otherConnectionId },
      { state, boundConnectionId: null },
    ]),
  )(
    "rejects a $state alternative bound as $boundConnectionId",
    async ({ state, boundConnectionId }) => {
      storedConnection(otherConnectionId, otherOrganizationId, state);
      identifier();
      identifier({ boundConnectionId, providerId: otherConnectionId });

      expect(await repository.findStrandedUserIds({ connectionId })).toEqual([memberId]);
    },
  );

  it.each([
    { boundConnectionId: otherConnectionId, provider: "google", providerId: "google" },
    { boundConnectionId: null, provider: "oidc", providerId: newSsoConnectionId() },
  ] satisfies {
    boundConnectionId: string | null;
    provider: IdentifierProvider;
    providerId: string;
  }[])(
    "rejects a missing explicit connection through $provider",
    async ({ boundConnectionId, provider, providerId }) => {
      identifier();
      identifier({ boundConnectionId, provider, providerId });

      expect(await repository.findStrandedUserIds({ connectionId })).toEqual([memberId]);
    },
  );

  it("ignores other providers, explicit sibling bindings and detached target identities", async () => {
    identifier({ userId: unrelatedId, boundConnectionId: null, providerId: otherConnectionId });
    identifier({ boundConnectionId: otherConnectionId });
    identifier({ state: "DETACHED" });

    expect(await repository.findStrandedUserIds({ connectionId })).toEqual([]);
  });

  it("matches the legacy broker subject only among this organization's members", async () => {
    storedConnection(connectionId, organizationId, "ACTIVE", {
      source: "legacy-grandfathered",
      providerId: "waad|acme",
    });
    identifier({
      boundConnectionId: null,
      providerId: "auth0",
      providerAccountId: "waad|acme|member",
    });
    identifier({
      userId: unrelatedId,
      boundConnectionId: null,
      providerId: "auth0",
      providerAccountId: "waad|acme|unrelated",
    });
    identifier({
      boundConnectionId: null,
      providerId: "auth0",
      providerAccountId: "waad|acme|alias",
    });

    expect(await repository.findStrandedUserIds({ connectionId })).toEqual([memberId]);
  });
});
