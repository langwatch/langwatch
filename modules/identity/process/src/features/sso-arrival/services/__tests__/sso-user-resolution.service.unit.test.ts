import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import {
  emptySsoConnection,
  type IdentifierFact,
  type ProposeLinkCommandData,
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

import { MemoryIdentityStore } from "../../../../repositories/memory/memory.identity.store.ts";
import { MemorySsoConnectionReadRepository } from "../../../sso-connection/repositories/memory/memory.sso-connection.repositories.ts";
import { MemorySsoRegistrantReadRepository } from "../../../sso-connection/repositories/memory/memory.sso-registrant.repository.ts";
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
  arrivalPolicy = "admit",
  proposalsFail = false,
}: {
  hosted?: boolean;
  proved?: boolean;
  owners?: string[];
  inactive?: boolean;
  membership?: Membership;
  state?: SsoConnectionState["state"];
  proof?: SsoDomainVerification;
  confirmed?: boolean;
  arrivalPolicy?: SsoConnectionState["arrivalPolicy"];
  proposalsFail?: boolean;
} = {}) {
  const store = MemoryIdentityStore.create();
  const connection: SsoConnectionState = {
    ...emptySsoConnection({ connectionId: CONNECTION_ID }),
    organizationId: ORGANIZATION_ID,
    state,
    replacesConnectionId: REPLACED_ID,
    arrivalPolicy,
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
  const proposals: ProposeLinkCommandData[] = [];
  const audits: Parameters<AuditLogApi["record"]>[0][] = [];
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
    proposals: {
      proposeLink: async (data) => {
        if (proposalsFail) throw new Error("ledger unavailable");
        proposals.push(data);
        return [];
      },
    },
    auditLog: createApiFixture<AuditLogApi>({
      record: async (input) => {
        audits.push(input);
        return { id: `audit_${audits.length}`, occurredAt: 0 };
      },
    }),
    isHosted: hosted,
  });
  return { store, service, proposals, audits };
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
const LINK_PROPOSED = { action: "reject", code: "identity_link_proposed" } as const;
/** Two holders of one address get a proposal; every other conflict keeps the library's refusal. */
const refusalFor = (failure: string) =>
  failure === "ambiguous-email" ? LINK_PROPOSED : NOT_LINKED;
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

      await expect(service.resolveUser(assertion())).resolves.toEqual(refusalFor(failure));
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

  describe("when the provider signs in the subject it already bound", () => {
    /** @scenario "A known provider subject signs straight in" */
    it("hands them to the library's own binding and writes nothing", async () => {
      const unbound = createWorld({ owners: [], proved: false });
      await expect(unbound.service.resolveUser(assertion())).resolves.toMatchObject({
        action: "reject",
      });

      const { store, service } = createWorld({ owners: [], proved: false });
      bind({ store });
      const accountsBefore = structuredClone(store.accounts);
      const identifiersBefore = structuredClone(store.identifiers);

      await expect(service.resolveUser(assertion())).resolves.toEqual({ action: "continue" });
      expect(store.accounts).toEqual(accountsBefore);
      expect(store.identifiers).toEqual(identifiersBefore);
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
    /** @scenario "An identity provider that asserts nothing refuses nothing" */
    it("links the existing account", async () => {
      const { service } = createWorld({ owners: [], proved: true, confirmed: true });

      await expect(service.resolveUser(UNASSERTED_ASSERTION)).resolves.toEqual(LINKED);
    });
  });

  describe("when the connection has not verified the domain", () => {
    /** @scenario "A confirmed account on a domain the connection has not verified is refused with the missing proof named" */
    it("refuses with the missing domain proof named", async () => {
      const { service } = createWorld({ owners: [], confirmed: true });

      await expect(service.resolveUser(UNASSERTED_ASSERTION)).resolves.toEqual({
        action: "reject",
        code: "sso_domain_not_verified",
      });
    });

    /** @scenario "Microsoft Entra ID's xms_edov true links a confirmed account without a domain proof" */
    it("links the existing account on Entra ID's verified domain claim", async () => {
      const { service } = createWorld({ owners: [], confirmed: true });

      await expect(
        service.resolveUser(assertion({ emailVerified: false, emailVerification: "verified" })),
      ).resolves.toEqual(LINKED);
    });
  });

  describe("when the provider sends email_verified true", () => {
    it("keeps the library's own link", async () => {
      const { service } = createWorld({ owners: [], proved: true, confirmed: true });

      await expect(service.resolveUser(assertion())).resolves.toEqual({ action: "continue" });
    });
  });
});

describe("given a person who signs in today through the provider the deployment brokers", () => {
  describe("when their organization cuts over to a connection it registered itself", () => {
    /** @scenario "Moving from the brokered provider to a direct one does not mint a second account" */
    it("links the new subject to the account they already had and creates none", async () => {
      const { store, service } = createWorld({ owners: [], proved: true, confirmed: true });
      store.accounts.set(USER_ID, [
        {
          id: "account-brokered",
          provider: "auth0",
          issuer: "https://brokered.example/",
          providerAccountId: "auth0|legacy-subject",
          createdAtMs: 0,
        },
      ]);

      await expect(service.resolveUser(UNASSERTED_ASSERTION)).resolves.toEqual(LINKED);

      expect([...store.users.values()].filter((user) => user.email === EMAIL)).toHaveLength(1);
      expect(store.users.size).toBe(1);
      expect(store.accounts.get(USER_ID)?.map((row) => row.id)).toEqual(["account-brokered"]);
    });
  });
});

describe("given a verified local account and a managed SAML connection", () => {
  const SAML_ASSERTION = assertion({
    protocol: "saml",
    emailVerified: false,
    emailVerification: "unasserted",
  });

  /** @scenario "A signed SAML assertion links a verified local account" */
  it("links the account, leaves its profile and verification alone, and continues on repeat", async () => {
    const { store, service } = createWorld({ owners: [], proved: true, confirmed: true });
    const before = structuredClone(store.users.get(USER_ID));

    await expect(service.resolveUser(SAML_ASSERTION)).resolves.toEqual(LINKED);
    expect(store.users.get(USER_ID)).toEqual(before);

    bind({ store });
    await expect(service.resolveUser(SAML_ASSERTION)).resolves.toEqual({ action: "continue" });

    expect(store.accounts.get(USER_ID)).toHaveLength(1);
    expect(store.users.get(USER_ID)).toEqual(before);
  });

  /** @scenario "A repeat SAML sign-in of a linked identity continues, never links" */
  it.each([
    ["a verified local account", { owners: [], proved: true, confirmed: true }],
    ["a directory-provisioned member", {}],
  ])("continues for %s once the binding exists", async (_name, world) => {
    const { store, service } = createWorld(world);
    store.identifiers.set("identifier_1", identifier({}));
    bind({ store });

    await expect(service.resolveUser(SAML_ASSERTION)).resolves.toEqual({ action: "continue" });
  });

  /** @scenario "SAML linking refuses unsuitable local identity evidence" */
  it.each(["inactive", "deactivated", "address-held", "subject-held"] as const)(
    "binds nothing and changes nothing for an account that is %s",
    async (kind) => {
      const { store, service } = createWorld({
        owners: kind === "inactive" ? [CONNECTION_ID] : [],
        proved: true,
        confirmed: true,
        inactive: kind === "inactive",
      });
      if (kind === "deactivated") store.deactivatedUsers.add(USER_ID);
      if (kind === "address-held" || kind === "subject-held") {
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
      const before = structuredClone(store.users.get(USER_ID));

      const outcome = await service.resolveUser(SAML_ASSERTION);

      expect(outcome.action).toBe("reject");
      expect(store.accounts.get(USER_ID) ?? []).toEqual([]);
      expect(store.users.get(USER_ID)).toEqual(before);
    },
  );
});

describe("given the callback linking rule (ADR-117 section 3)", () => {
  describe("when the one account holding the address is linked on the connection's word", () => {
    /** @scenario "An unambiguous verified match is auto-linked with an audit trail" */
    it("links it and records the attempt before the library writes, by domain only", async () => {
      const { service, audits, proposals } = createWorld({ confirmed: true });

      await expect(service.resolveUser(assertion({ protocol: "saml" }))).resolves.toEqual(LINKED);
      expect(audits).toEqual([
        {
          userId: USER_ID,
          organizationId: ORGANIZATION_ID,
          action: "identity.sso.link_attempted",
          args: {
            connectionId: CONNECTION_ID,
            protocol: "saml",
            issuer: ISSUER,
            subject: SUBJECT,
            domain: DOMAIN,
          },
          targetKind: "user",
          targetId: USER_ID,
        },
      ]);
      expect(JSON.stringify(audits)).not.toContain(EMAIL);
      expect(proposals).toEqual([]);
    });

    /** @scenario "An unambiguous verified match is auto-linked with an audit trail" */
    it("records no attempt when the library signs a returning subject in itself", async () => {
      const { service, store, audits } = createWorld({ confirmed: true });
      bind({ store });

      await expect(service.resolveUser(assertion({ protocol: "saml" }))).resolves.toEqual({
        action: "continue",
      });
      expect(audits).toEqual([]);
    });
  });

  describe("when the account holds the address with no verification evidence", () => {
    /** @scenario "An unverified orphan is never auto-linked" */
    it("refuses with guidance and records a proposal instead of linking", async () => {
      const { service, proposals, audits } = createWorld({ owners: [] });

      await expect(service.resolveUser(UNVERIFIED_ASSERTION)).resolves.toEqual(UNCONFIRMED);
      expect(proposals).toEqual([
        expect.objectContaining({
          tenantId: USER_ID,
          userId: USER_ID,
          connectionId: CONNECTION_ID,
          provider: "oidc",
          providerAccountId: SUBJECT,
          value: EMAIL,
          reason: "unverified_orphan",
          actor: { type: "system", id: null },
        }),
      ]);
      expect(audits).toEqual([]);
    });

    /** @scenario "An unverified orphan is never auto-linked" */
    it("proposes the same way for SAML on a domain the connection has not proved", async () => {
      const { service, proposals } = createWorld({ owners: [] });

      await expect(service.resolveUser(assertion({ protocol: "saml" }))).resolves.toEqual(
        UNCONFIRMED,
      );
      expect(proposals.map((proposal) => proposal.reason)).toEqual(["unverified_orphan"]);
    });

    it("keeps the refusal when the proposal cannot be recorded", async () => {
      const { service } = createWorld({ owners: [], proposalsFail: true });

      await expect(service.resolveUser(UNVERIFIED_ASSERTION)).resolves.toEqual(UNCONFIRMED);
    });
  });

  describe("when more than one account holds the address", () => {
    /** @scenario "An ambiguous match becomes a proposal, not a guess" */
    it("proposes against every holder and refuses with guidance", async () => {
      const { service, store, proposals, audits } = createWorld({ confirmed: true });
      store.users.set("user_twin", {
        id: "user_twin",
        email: EMAIL.toUpperCase(),
        emailVerified: true,
        createdAtMs: 0,
        userHashKey: null,
        payload: {},
      });

      await expect(service.resolveUser(assertion())).resolves.toEqual(LINK_PROPOSED);
      expect(proposals.map(({ userId, reason }) => [userId, reason])).toEqual([
        [USER_ID, "ambiguous_candidates"],
        ["user_twin", "ambiguous_candidates"],
      ]);
      expect(audits).toEqual([]);
    });
  });

  describe("when nobody holds the address", () => {
    const stranger = assertion({
      email: `new@${DOMAIN}`,
      accountKey: { issuer: ISSUER, accountId: "subject-new" },
    });

    /** @scenario "No match provisions just-in-time only where the connection allows" */
    it("leaves creation to the library only where the connection admits newcomers", async () => {
      const admitting = createWorld({ arrivalPolicy: "admit" });
      const refusing = createWorld({ arrivalPolicy: "refuse" });

      await expect(admitting.service.resolveUser(stranger)).resolves.toEqual({
        action: "continue",
      });
      await expect(refusing.service.resolveUser(stranger)).resolves.toEqual({
        action: "reject",
        code: "identity_jit_disabled",
      });
    });

    it("still signs a known subject in on a connection that refuses newcomers", async () => {
      const { service, store } = createWorld({ arrivalPolicy: "refuse" });
      bind({ store });

      await expect(service.resolveUser(assertion({ email: `renamed@${DOMAIN}` }))).resolves.toEqual(
        { action: "continue" },
      );
    });
  });
});
