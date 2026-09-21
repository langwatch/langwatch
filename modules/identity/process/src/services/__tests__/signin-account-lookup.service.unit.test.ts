/**
 * What the sign-in router is told an address's account holds (ADR-117).
 * @see modules/identity/specs/signin-router.feature
 */
import { emptyIdentityHeads, type IdentifierFact } from "@langwatch/identity-contract";
import { describe, expect, it } from "vitest";

import { IdentityHeadsRepository } from "../../repositories/identity-heads.repository.ts";
import { MemoryIdentityStore } from "../../repositories/memory/memory-identity.store.ts";
import { MemoryIdentitySignInAccountsRepository } from "../../repositories/memory/memory.identity-signin-accounts.repository.ts";
import { SignInAccountLookupService } from "../signin-account-lookup.service.ts";

/** Only the two reads the lookup makes; the rest of the port is unreachable here. */
class SeededHeads extends IdentityHeadsRepository {
  constructor(private readonly facts: readonly IdentifierFact[]) {
    super();
  }

  async tryFindActiveIdentifierByValue({ normalizedValue }: { normalizedValue: string }) {
    const held = this.facts.find(
      (fact) =>
        fact.value === normalizedValue && (fact.state === "VERIFIED" || fact.state === "PRIMARY"),
    );

    return held ? { userId: held.userId, identifierId: held.identifierId } : null;
  }

  async findHeads({ userId }: { userId: string }) {
    const heads = emptyIdentityHeads({ userId });
    for (const fact of this.facts.filter((candidate) => candidate.userId === userId)) {
      heads.identifiers[fact.identifierId] = fact;
    }

    return heads;
  }

  async tryFindUserHashKey() {
    return null;
  }

  async hasFolded() {
    return true;
  }

  async tryFindIdentifier() {
    return null;
  }

  async tryFindIdentifierIdForAccount() {
    return null;
  }
}

const ADDRESS = "sam@acme.com";

const head = (overrides: Partial<IdentifierFact> = {}): IdentifierFact => ({
  identifierId: "identifier_1",
  userId: "user_sam",
  provider: "credential",
  value: ADDRESS,
  domain: "acme.com",
  identifierHash: null,
  accountId: null,
  providerId: null,
  issuer: null,
  providerAccountId: null,
  connectionId: null,
  state: "VERIFIED",
  verifiedAtMs: 0,
  attachedAtMs: 0,
  detachedAtMs: null,
  ...overrides,
});

function lookupOver({
  heads: seeded = [],
  latched = new Set<string>(["user_sam"]),
  legacy,
}: {
  heads?: readonly IdentifierFact[];
  latched?: ReadonlySet<string>;
  legacy?: Parameters<MemoryIdentityStore["legacySignInAccounts"]["set"]>[1];
} = {}) {
  const store = MemoryIdentityStore.create();
  if (legacy) store.legacySignInAccounts.set(ADDRESS, legacy);

  return SignInAccountLookupService.create({
    heads: new SeededHeads(seeded),
    legacy: MemoryIdentitySignInAccountsRepository.create(store),
    isLatched: async ({ userId }) => latched.has(userId),
  });
}

describe("SignInAccountLookupService", () => {
  describe("when the address's holder has latched onto the projection", () => {
    /** @scenario "The methods offered are the ones that account holds" */
    it("answers from live identifier heads, and counts no detached one", async () => {
      const lookup = lookupOver({
        heads: [
          head(),
          head({
            identifierId: "identifier_2",
            provider: "passkey",
            value: null,
            state: "PRIMARY",
          }),
          head({
            identifierId: "identifier_3",
            provider: "oidc",
            providerId: "auth0",
            connectionId: "connection_1",
            value: null,
            state: "DETACHED",
          }),
        ],
      });

      await expect(lookup.findAccountMethods({ normalizedValue: ADDRESS })).resolves.toEqual({
        hasPassword: true,
        hasPasskey: true,
        providerIds: [],
        connectionIds: [],
      });
    });

    /** @scenario "The methods offered are the ones that account holds" */
    it("deduplicates the connections behind two identifiers of one person", async () => {
      const lookup = lookupOver({
        heads: [
          head({ provider: "oidc", providerId: "okta", connectionId: "connection_1" }),
          head({
            identifierId: "identifier_2",
            provider: "oidc",
            providerId: "okta",
            connectionId: "connection_1",
            value: null,
          }),
        ],
      });

      await expect(lookup.findAccountMethods({ normalizedValue: ADDRESS })).resolves.toMatchObject({
        providerIds: ["okta"],
        connectionIds: ["connection_1"],
      });
    });
  });

  describe("when no identifier holds the address", () => {
    /** @scenario "An address with no account carries on as a sign-up" */
    it("routes a truly unknown address to sign-up by answering nobody", async () => {
      await expect(
        lookupOver().findAccountMethods({ normalizedValue: ADDRESS }),
      ).resolves.toBeNull();
    });

    /** @scenario "An account still waiting for identifier backfill keeps its way in" */
    it("falls back to the legacy rows of an account that has not latched", async () => {
      const lookup = lookupOver({
        latched: new Set(),
        legacy: {
          userId: "user_sam",
          methods: {
            hasPassword: false,
            hasPasskey: true,
            providerIds: ["auth0"],
            connectionIds: [],
          },
          auth0Subjects: ["auth0|abc"],
        },
      });

      await expect(lookup.findAccountMethods({ normalizedValue: ADDRESS })).resolves.toMatchObject({
        hasPasskey: true,
        providerIds: ["auth0"],
      });
    });

    /** @scenario "A migrated account is answered from the projection alone" */
    it("reads no legacy row once that account has latched", async () => {
      const lookup = lookupOver({
        legacy: {
          userId: "user_sam",
          methods: {
            hasPassword: true,
            hasPasskey: false,
            providerIds: [],
            connectionIds: [],
          },
          auth0Subjects: [],
        },
      });

      await expect(lookup.findAccountMethods({ normalizedValue: ADDRESS })).resolves.toBeNull();
    });
  });

  describe("when the projection holds the address but its owner has not latched", () => {
    /** @scenario "An account still waiting for identifier backfill keeps its way in" */
    it("prefers the legacy rows over partial heads", async () => {
      const lookup = lookupOver({
        heads: [head({ provider: "email" })],
        latched: new Set(),
        legacy: {
          userId: "user_sam",
          methods: {
            hasPassword: true,
            hasPasskey: false,
            providerIds: ["okta"],
            connectionIds: [],
          },
          auth0Subjects: [],
        },
      });

      await expect(lookup.findAccountMethods({ normalizedValue: ADDRESS })).resolves.toMatchObject({
        hasPassword: true,
        providerIds: ["okta"],
      });
    });
  });
});
