import type {
  SsoArrivalApi,
  SsoAuthenticationActivityApi,
  SsoMigrationCallbackApi,
} from "@langwatch/identity-contract";
import { OrganizationNotFoundError } from "@langwatch/organization-contract";
/**
 * A native social button pressed by somebody whose organization's connection governs their
 * address, on both account seams: the refusal carries the connection so the error route can
 * dial it.
 * @see specs/identity/native-social-at-a-claimed-domain.feature
 * @see specs/auth/phase-1-better-auth-config.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant, toDate } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import type { BetterAuthFederation } from "../../channels/better-auth.channel.ts";
import {
  afterAccountUpdate,
  type BetterAuthHookCollaborators,
  createBeforeAccountCreateHook,
  type FindGoverningConnections,
} from "../../channels/http/http.better-auth-hooks.channel.ts";
import type {
  BetterAuthHookOrganization,
  BetterAuthHooksRepository,
} from "../../repositories/better-auth-hooks.repository.ts";

const CONNECTION = "local_ssoc_acme";

const licensed = createApiFixture<BetterAuthFederation>({
  platformSsoAllowed: async () => true,
});

/** The router's answer: acme.com is the connection's, every other domain nobody's. */
const acmeGoverned: FindGoverningConnections = async ({ email }) =>
  email.endsWith("@acme.com") ? [CONNECTION] : [];

function repoFor({
  email = "sam@acme.com",
  organization = null,
}: {
  email?: string;
  organization?: BetterAuthHookOrganization | null;
} = {}) {
  const flagPendingSsoSetup = vi.fn(async () => undefined);
  const repo = createApiFixture<BetterAuthHooksRepository>({
    getUserForHooks: async () => ({
      id: "user_1",
      email,
      name: "Sam",
      deactivatedAt: null,
      pendingSsoSetup: false,
      signupConfirmationPending: false,
    }),
    getOrganizationBySsoDomain: async () => {
      if (organization === null) throw new OrganizationNotFoundError();
      return organization;
    },
    countAccountsForUser: async () => 1,
    findFederatedAccountsForUser: async () => [],
    flagPendingSsoSetup,
  });
  return { repo, flagPendingSsoSetup };
}

function accountFor(providerId: string, accountId = `${providerId}|123`) {
  const now = toDate(nowInstant());
  return {
    id: "account-1",
    userId: "user_1",
    providerId,
    issuer: `https://${providerId}.issuer.test`,
    accountId,
    createdAt: now,
    updatedAt: now,
  };
}

function collaborators(admit = vi.fn(async () => undefined)): BetterAuthHookCollaborators {
  return {
    federation: licensed,
    invites: createApiFixture<BetterAuthHookCollaborators["invites"]>(),
    announcements: createApiFixture<BetterAuthHookCollaborators["announcements"]>(),
    authzGrants: createApiFixture<BetterAuthHookCollaborators["authzGrants"]>(),
    arrivals: createApiFixture<SsoArrivalApi>({ admit }),
    ssoActivity: createApiFixture<SsoAuthenticationActivityApi>({ record: async () => undefined }),
    ssoMigration: createApiFixture<SsoMigrationCallbackApi>({
      decideAccountLink: async () => ({ kind: "not_migrating" }),
    }),
  };
}

function signUp({
  providerId,
  accountId,
  repo = repoFor().repo,
}: {
  providerId: string;
  accountId?: string;
  repo?: BetterAuthHooksRepository;
}) {
  return createBeforeAccountCreateHook({
    repo,
    federation: licensed,
    findGoverningConnections: acmeGoverned,
  })(accountFor(providerId, accountId), null);
}

describe("a native social sign-up at a domain a live connection proved", () => {
  /** @scenario "A native social sign-up on a proved domain is refused" */
  it("refuses before the Google identity is attached", async () => {
    await expect(signUp({ providerId: "google" })).rejects.toMatchObject({
      body: { code: "SSO_REQUIRED_BY_ORGANIZATION" },
    });
  });

  /** @scenario "The refusal names the connection, so it can be walked into" */
  it("carries the connection as the refusal's message", async () => {
    await expect(signUp({ providerId: "github" })).rejects.toMatchObject({
      body: { code: "SSO_REQUIRED_BY_ORGANIZATION", message: CONNECTION },
    });
  });

  /** @scenario "The connection dialling itself is not a native button" */
  it("lets the connection itself through", async () => {
    await expect(signUp({ providerId: CONNECTION })).resolves.toBeUndefined();
  });

  /** @scenario "A brokered sign-in mid-migration is left alone" */
  it("lets the broker through on another connection", async () => {
    await expect(
      signUp({ providerId: "auth0", accountId: "waad|other-conn|sam" }),
    ).resolves.toBeUndefined();
  });

  it("lets an address no connection governs through", async () => {
    await expect(
      signUp({ providerId: "google", repo: repoFor({ email: "sam@notacme.com" }).repo }),
    ).resolves.toBeUndefined();
  });
});

describe("a native social sign-in on an already-linked account", () => {
  /** @scenario "An already-linked native account is refused on the sign-in path too" */
  it("is refused on the update seam, which is the only one a returning sign-in passes", async () => {
    const admit = vi.fn(async () => undefined);
    await expect(
      afterAccountUpdate({
        repo: repoFor().repo,
        account: accountFor("google"),
        collaborators: collaborators(admit),
        findGoverningConnections: acmeGoverned,
      }),
    ).rejects.toMatchObject({
      body: { code: "SSO_REQUIRED_BY_ORGANIZATION", message: CONNECTION },
    });
    expect(admit).not.toHaveBeenCalled();
  });

  it("admits the connection's own returning sign-in", async () => {
    const admit = vi.fn(async () => undefined);
    await afterAccountUpdate({
      repo: repoFor().repo,
      account: accountFor(CONNECTION),
      collaborators: collaborators(admit),
      findGoverningConnections: acmeGoverned,
    });
    expect(admit).toHaveBeenCalledWith(expect.objectContaining({ connectionId: CONNECTION }));
  });
});

describe("the legacy ssoDomain columns", () => {
  const LEGACY = { id: "org_acme", name: "Acme", ssoDomain: "acme.com", ssoProvider: "waad|acme" };
  const nobodyGoverns: FindGoverningConnections = async () => [];

  /** @scenario "A native social sign-in at an SSO-enforced domain is refused" */
  it("refuses a native provider for an existing member and leaves pendingSsoSetup alone", async () => {
    const { repo, flagPendingSsoSetup } = repoFor({ organization: LEGACY });
    await expect(
      createBeforeAccountCreateHook({
        repo,
        federation: licensed,
        findGoverningConnections: nobodyGoverns,
      })(accountFor("google"), null),
    ).rejects.toMatchObject({ body: { code: "SSO_PROVIDER_NOT_ALLOWED" } });
    expect(flagPendingSsoSetup).not.toHaveBeenCalled();
  });

  /** @scenario "A native social sign-in on an already-linked account is refused too" */
  it("refuses a native provider on the update seam", async () => {
    await expect(
      afterAccountUpdate({
        repo: repoFor({ organization: LEGACY }).repo,
        account: accountFor("google"),
        collaborators: collaborators(),
        findGoverningConnections: nobodyGoverns,
      }),
    ).rejects.toMatchObject({ body: { code: "SSO_PROVIDER_NOT_ALLOWED" } });
  });

  /** @scenario "An organization pinned to Google still signs in with Google" */
  it("lets an organization pinned to Google sign in with Google on both seams", async () => {
    const { repo, flagPendingSsoSetup } = repoFor({
      organization: { ...LEGACY, ssoProvider: "google" },
    });
    await createBeforeAccountCreateHook({
      repo,
      federation: licensed,
      findGoverningConnections: nobodyGoverns,
    })(accountFor("google"), null);
    await afterAccountUpdate({
      repo,
      account: accountFor("google"),
      collaborators: collaborators(),
      findGoverningConnections: nobodyGoverns,
    });
    expect(flagPendingSsoSetup).not.toHaveBeenCalled();
  });
});
