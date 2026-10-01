import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import {
  emptySsoConnection,
  type IdentifierFact,
  type SsoConnectionState,
  type SsoDomainVerification,
  type SsoUserResolutionInput,
} from "@langwatch/identity-contract";
import { MemberNotFoundError, type OrganizationApi } from "@langwatch/organization-contract";
/**
 * Which existing person an admitted assertion signs in as, over the memory tier.
 * Specs: specs/identity/scim-sso-signin.feature, scim-connection-sync.feature and
 * sso-link-unconfirmed-local-account.feature.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryIdentityStore } from "../../repositories/memory/memory.identity.store.ts";
import { MemorySsoConnectionReadRepository } from "../../repositories/memory/memory.sso-connection.repositories.ts";
import { MemorySsoRegistrantReadRepository } from "../../repositories/memory/memory.sso-registrant.repository.ts";
import { SsoUserResolutionService } from "../sso-user-resolution.service.ts";

const CONNECTION_ID = "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW368m";
const REPLACED_ID = "local_ssoc_0005NmMMMX8uk3JfupN0JsNdW999zz";
const ORGANIZATION_ID = "org_acme";
const DOMAIN = "acme.test";
const ISSUER = "https://idp.acme.test";
const USER_ID = "user_sam";
const EMAIL = `sam@${DOMAIN}`;
const SUBJECT = "subject-sam";

const PROOF: SsoDomainVerification = {
  domain: DOMAIN,
  method: "dns-txt",
  actorId: null,
  verifiedAtMs: 1_756_000_000_000,
  proofState: "VERIFIED",
  firstAbsentAtMs: null,
  graceEndsAtMs: null,
  tokenHash: "sha256:proof",
};

type Membership = "active" | "disabled" | "missing";

/** One connection, one person at the asserted address, and the peers' answers about them. */
function createWorld({
  hosted = false,
  proved = false,
  owners = [CONNECTION_ID],
  inactive = false,
  membership = "active",
  state = "ACTIVE",
  proof = PROOF,
  confirmed = false,
}: {
  hosted?: boolean;
  proved?: boolean;
  owners?: string[];
  inactive?: boolean;
  membership?: Membership;
  state?: SsoConnectionState["state"];
  proof?: SsoDomainVerification;
  confirmed?: boolean;
} = {}) {
  const store = MemoryIdentityStore.create();
  const connection: SsoConnectionState = {
    ...emptySsoConnection({ connectionId: CONNECTION_ID }),
    organizationId: ORGANIZATION_ID,
    state,
    replacesConnectionId: REPLACED_ID,
    verifiedDomains: proved ? [DOMAIN] : [],
    domainVerifications: proved ? [proof] : [],
  };
  store.ssoConnections.set(CONNECTION_ID, connection);
  store.users.set(USER_ID, {
    id: USER_ID,
    email: EMAIL,
    emailVerified: confirmed,
    createdAtMs: 0,
    userHashKey: null,
    payload: {},
  });
  const service = SsoUserResolutionService.create({
    people: MemorySsoRegistrantReadRepository.create(store),
    connections: MemorySsoConnectionReadRepository.create(store),
    directory: createApiFixture<ScimApi>({
      isDirectoryUserInactive: async ({ userId }) => inactive && userId === USER_ID,
      findDirectoryConnectionsForUser: async ({ userId }) => (userId === USER_ID ? owners : []),
    }),
    memberships: createApiFixture<OrganizationApi>({
      getMember: async ({ organizationId, userId }) => {
        if (membership === "missing") throw new MemberNotFoundError(userId);
        return {
          userId,
          organizationId,
          role: "MEMBER",
          disabledAt: membership === "disabled" ? nowInstant() : null,
          createdAt: nowInstant(),
          updatedAt: nowInstant(),
          user: { id: userId, name: "Sam", email: EMAIL },
          teams: [],
        };
      },
    }),
    isHosted: hosted,
  });
  return { store, service };
}

function assertion(over: Partial<SsoUserResolutionInput> = {}): SsoUserResolutionInput {
  return {
    protocol: "oidc",
    providerId: CONNECTION_ID,
    accountKey: { issuer: ISSUER, accountId: SUBJECT },
    email: EMAIL,
    emailVerified: true,
    emailVerification: "verified",
    ...over,
  };
}

function identifier(over: Partial<IdentifierFact>): IdentifierFact {
  return {
    identifierId: "identifier_1",
    userId: USER_ID,
    provider: "email",
    value: EMAIL,
    domain: DOMAIN,
    identifierHash: null,
    accountId: null,
    providerId: null,
    issuer: null,
    providerAccountId: null,
    connectionId: null,
    state: "ATTACHED",
    verifiedAtMs: null,
    attachedAtMs: 0,
    detachedAtMs: null,
    ...over,
  };
}

const bind = ({ store, userId = USER_ID }: { store: MemoryIdentityStore; userId?: string }) =>
  store.accounts.set(userId, [
    {
      id: `account-${userId}`,
      provider: CONNECTION_ID,
      issuer: ISSUER,
      providerAccountId: SUBJECT,
      createdAtMs: 0,
    },
  ]);

const LINKED_AND_CONFIRMED = {
  action: "link",
  userId: USER_ID,
  profile: "preserve",
  confirmAddress: true,
} as const;
const LINKED = { action: "link", userId: USER_ID, profile: "preserve" } as const;
const NOT_LINKED = { action: "reject", code: "OAuthAccountNotLinked" } as const;
const UNCONFIRMED = { action: "reject", code: "sso_existing_account_unconfirmed" } as const;
/** The provider said the address is not verified. */
const UNVERIFIED_ASSERTION = assertion({ emailVerified: false, emailVerification: "unverified" });
/** Entra ID without `xms_edov`: no verification claim at all. */
const UNASSERTED_ASSERTION = assertion({ emailVerified: false, emailVerification: "unasserted" });

describe("given a member this connection's directory provisioned", () => {
  describe("when its verified provider signs them in for the first time", () => {
    /** @scenario "A provisioned member signs in without creating another account" */
    it("selects the existing member, leaves their address unconfirmed, and keeps the binding on repeat", async () => {
      const { store, service } = createWorld();
      store.identifiers.set("identifier_1", identifier({}));

      await expect(service.resolveUser(assertion())).resolves.toEqual(LINKED);
      expect(store.users.get(USER_ID)?.emailVerified).toBe(false);

      bind({ store });
      await expect(service.resolveUser(assertion())).resolves.toEqual(LINKED);
    });
  });

  describe("when the previous connection's sync provisioned them", () => {
    /** @scenario "A person the previous connection's sync provisioned can sign in through the replacement before the update finishes" */
    it("is recognised on the previous connection's word", async () => {
      const { service } = createWorld({ owners: [REPLACED_ID] });

      await expect(service.resolveUser(assertion())).resolves.toEqual(LINKED);
    });
  });

  describe("when the assertion is signed SAML with no OIDC verification claim", () => {
    /** @scenario "A signed SAML email does not require an OIDC verification claim" */
    it("selects the same connection's active provisioned member", async () => {
      const { service } = createWorld();

      await expect(
        service.resolveUser(
          assertion({ protocol: "saml", emailVerified: false, emailVerification: "unasserted" }),
        ),
      ).resolves.toEqual(LINKED);
    });
  });

  describe("when this organization's directory holds them as inactive", () => {
    /** @scenario "An inactive directory user cannot sign in through its connection" */
    it.each(["first", "linked", "changed-email"])("refuses the %s sign-in", async (kind) => {
      const { store, service } = createWorld({ inactive: true });
      if (kind !== "first") bind({ store });
      const email = kind === "changed-email" ? `renamed-${EMAIL}` : EMAIL;

      await expect(service.resolveUser(assertion({ email }))).resolves.toEqual(NOT_LINKED);
    });
  });

  describe("when other sign-in evidence is unsuitable", () => {
    /** @scenario "SCIM ownership cannot override conflicting sign-in evidence" */
    it.each(["disabled", "missing"] as const)("refuses a %s membership", async (membership) => {
      const { service } = createWorld({ membership });

      await expect(service.resolveUser(assertion())).resolves.toEqual(NOT_LINKED);
    });

    /** @scenario "SCIM ownership cannot override conflicting sign-in evidence" */
    it.each([
      "deactivated-user",
      "account-conflict",
      "subject-account-conflict",
      "identifier-conflict",
      "own-identifier",
      "verified-email",
      "attached-with-account",
      "null-email-identifier",
      "credential-without-projection",
      "ambiguous-email",
    ])("refuses %s", async (failure) => {
      const { store, service } = createWorld();
      store.identifiers.set("identifier_1", identifier({}));
      if (failure === "deactivated-user") store.deactivatedUsers.add(USER_ID);
      if (failure === "account-conflict") {
        store.accounts.set(USER_ID, [
          {
            id: "credential",
            provider: "credential",
            issuer: "credential",
            providerAccountId: USER_ID,
            createdAtMs: 0,
          },
        ]);
      }
      if (failure === "subject-account-conflict") bind({ store, userId: "user_other" });
      if (failure === "identifier-conflict" || failure === "own-identifier") {
        store.identifiers.set(
          "identifier_2",
          identifier({
            identifierId: "identifier_2",
            userId: failure === "own-identifier" ? USER_ID : "user_other",
            provider: "oidc",
            state: "VERIFIED",
            issuer: ISSUER,
            providerId: CONNECTION_ID,
            providerAccountId: SUBJECT,
          }),
        );
      }
      if (failure === "verified-email") {
        store.identifiers.set("identifier_1", identifier({ state: "VERIFIED", verifiedAtMs: 1 }));
      }
      if (failure === "attached-with-account") {
        store.identifiers.set(
          "identifier_1",
          identifier({ accountId: "credential", providerId: "credential" }),
        );
      }
      if (failure === "null-email-identifier") {
        store.identifiers.set("identifier_1", identifier({ value: null }));
      }
      if (failure === "credential-without-projection") {
        store.legacySignInAccounts.set(EMAIL, {
          userId: USER_ID,
          methods: { hasPassword: true, hasPasskey: false, providerIds: [], connectionIds: [] },
          auth0Subjects: [],
        });
      }
      if (failure === "ambiguous-email") {
        store.users.set("user_twin", {
          id: "user_twin",
          email: EMAIL.toUpperCase(),
          emailVerified: false,
          createdAtMs: 0,
          userHashKey: null,
          payload: {},
        });
      }

      await expect(service.resolveUser(assertion())).resolves.toEqual(NOT_LINKED);
    });

    /** @scenario "SCIM ownership cannot override conflicting sign-in evidence" */
    it("names the unconfirmed account when another connection's directory owns them", async () => {
      const { service } = createWorld({ owners: ["local_ssoc_other"] });

      await expect(service.resolveUser(assertion())).resolves.toEqual(UNCONFIRMED);
    });
  });
});

describe("given a password account whose address was never confirmed", () => {
  describe("when the live connection has verified the account's domain", () => {
    /** @scenario "A verified domain's identity provider links an unconfirmed password account" */
    it("links the existing account and asks for its address to be confirmed", async () => {
      const { service } = createWorld({ owners: [], proved: true });

      await expect(service.resolveUser(assertion())).resolves.toEqual(LINKED_AND_CONFIRMED);
    });
  });

  describe("when the connection in setup has verified the domain by licence", () => {
    /** @scenario "The setup test sign-in links the registrant's unconfirmed password account" */
    it("links the registrant's account and asks for its address to be confirmed", async () => {
      const { service } = createWorld({
        owners: [],
        proved: true,
        state: "DRAFT",
        proof: {
          ...PROOF,
          method: "license-token",
          actorId: USER_ID,
          evidenceRef: "licence_1",
          tokenHash: null,
        },
      });

      await expect(service.resolveUser(assertion())).resolves.toEqual(LINKED_AND_CONFIRMED);
    });
  });

  describe("when the connection has not verified the account's domain", () => {
    /** @scenario "An unconfirmed account on a domain the connection has not verified is not linked" */
    it("refuses by name and leaves the address unconfirmed", async () => {
      const { store, service } = createWorld({ owners: [] });

      await expect(service.resolveUser(assertion())).resolves.toEqual(UNCONFIRMED);
      expect(store.users.get(USER_ID)?.emailVerified).toBe(false);
    });
  });

  describe("when the provider says the address is not verified", () => {
    /** @scenario "An identity provider that says the address is not verified does not link an unconfirmed account" */
    /** @scenario "Microsoft Entra ID's xms_edov false does not link an unconfirmed account" */
    it("refuses by name although the domain is verified", async () => {
      const { store, service } = createWorld({ owners: [], proved: true });

      await expect(service.resolveUser(UNVERIFIED_ASSERTION)).resolves.toEqual(UNCONFIRMED);
      expect(store.users.get(USER_ID)?.emailVerified).toBe(false);
    });
  });

  describe("when the provider sends no verification claim", () => {
    /** @scenario "Microsoft Entra ID links an unconfirmed password account without sending email_verified" */
    it("links the existing account and asks for its address to be confirmed", async () => {
      const { service } = createWorld({ owners: [], proved: true });

      await expect(service.resolveUser(UNASSERTED_ASSERTION)).resolves.toEqual(
        LINKED_AND_CONFIRMED,
      );
    });

    /** @scenario "An unconfirmed account on a domain the connection has not verified is not linked" */
    it("refuses by name when the domain is not verified", async () => {
      const { service } = createWorld({ owners: [] });

      await expect(service.resolveUser(UNASSERTED_ASSERTION)).resolves.toEqual(UNCONFIRMED);
    });
  });

  describe("when a SAML connection signs the address in", () => {
    /** @scenario "A SAML connection links an unconfirmed password account on a verified domain" */
    it("links the existing account and asks for its address to be confirmed", async () => {
      const { service } = createWorld({ owners: [], proved: true });

      await expect(
        service.resolveUser(
          assertion({ protocol: "saml", emailVerified: false, emailVerification: "unasserted" }),
        ),
      ).resolves.toEqual(LINKED_AND_CONFIRMED);
    });
  });

  describe("when the account is deactivated or contested", () => {
    /** @scenario "A deactivated or contested unconfirmed account is not linked" */
    it.each(["deactivated", "address-held", "subject-held"])(
      "refuses the %s account",
      async (kind) => {
        const { store, service } = createWorld({ owners: [], proved: true });
        if (kind === "deactivated") store.deactivatedUsers.add(USER_ID);
        if (kind !== "deactivated") {
          store.identifiers.set(
            "identifier_other",
            identifier({
              identifierId: "identifier_other",
              userId: "user_other",
              state: "VERIFIED",
              value: kind === "address-held" ? EMAIL : `other@${DOMAIN}`,
              ...(kind === "subject-held" ? { issuer: ISSUER, providerAccountId: SUBJECT } : {}),
            }),
          );
        }

        await expect(service.resolveUser(assertion())).resolves.toEqual(NOT_LINKED);
        expect(store.users.get(USER_ID)?.emailVerified).toBe(false);
      },
    );
  });

  describe("when the account already holds this connection's binding", () => {
    /** @scenario "A person already bound to the connection keeps signing in with an unconfirmed address" */
    it("hands them to the library's own binding without the provider's word", async () => {
      const { store, service } = createWorld({ owners: [], proved: true });
      bind({ store });

      await expect(service.resolveUser(UNVERIFIED_ASSERTION)).resolves.toEqual({
        action: "continue",
      });
    });

    /** @scenario "A person already bound to the connection keeps signing in with an unconfirmed address" */
    it("hands them to the library's own binding before the domain is verified", async () => {
      const { store, service } = createWorld({ owners: [], proved: false });
      bind({ store });

      await expect(service.resolveUser(assertion())).resolves.toEqual({ action: "continue" });
    });
  });

  describe("when the installation is LangWatch Cloud", () => {
    /** @scenario "On LangWatch Cloud an unconfirmed password account is not linked by single sign-on" */
    it("leaves the link to the library's own rule, which refuses an unconfirmed address", async () => {
      const { store, service } = createWorld({ hosted: true, owners: [], proved: true });

      await expect(service.resolveUser(assertion())).resolves.toEqual({ action: "continue" });
      expect(store.users.get(USER_ID)?.emailVerified).toBe(false);
    });

    /** @scenario "On LangWatch Cloud a provider that sends no email_verified does not link an existing account" */
    it("leaves a provider that sends no email_verified to the library's own rule", async () => {
      const { service } = createWorld({ hosted: true, owners: [], proved: true });

      await expect(
        service.resolveUser(assertion({ emailVerified: false, emailVerification: "verified" })),
      ).resolves.toEqual({ action: "continue" });
    });
  });
});

describe("given a password account whose address is confirmed", () => {
  describe("when the provider sends no email_verified and the connection proved the domain", () => {
    /** @scenario "A confirmed password account links when the provider sends no email_verified" */
    it("links the existing account", async () => {
      const { service } = createWorld({ owners: [], proved: true, confirmed: true });

      await expect(service.resolveUser(UNASSERTED_ASSERTION)).resolves.toEqual(LINKED);
    });
  });

  describe("when the connection has not verified the domain", () => {
    it("leaves the link to the library's own rule", async () => {
      const { service } = createWorld({ owners: [], confirmed: true });

      await expect(service.resolveUser(UNASSERTED_ASSERTION)).resolves.toEqual({
        action: "continue",
      });
    });
  });

  describe("when the provider sends email_verified true", () => {
    it("keeps the library's own link", async () => {
      const { service } = createWorld({ owners: [], proved: true, confirmed: true });

      await expect(service.resolveUser(assertion())).resolves.toEqual({ action: "continue" });
    });
  });
});
