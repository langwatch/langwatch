/**
 * A federated sign-in is asked of the connection it arrived through, on the
 * account hooks — the only two places a sign-in touches this process.
 *
 * @see specs/identity/sso-activation.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import type { SsoArrivalApi, SsoAuthenticationActivityApi } from "@langwatch/identity-contract";
import { describe, expect, it, vi } from "vitest";

import type {
  BetterAuthAnnouncements,
  BetterAuthFederation,
  BetterAuthPendingInvite,
} from "../../channels/better-auth.channel.ts";
import type { BetterAuthHookCollaborators } from "../../channels/http/http.better-auth-hooks.channel.ts";
import {
  afterAccountCreate,
  afterAccountUpdate,
} from "../../channels/http/http.better-auth-hooks.channel.ts";
import type {
  BetterAuthHooksRepository,
  BetterAuthHookUser,
} from "../../repositories/better-auth-hooks.repository.ts";

const WORKER: BetterAuthHookUser = {
  id: "user_1",
  email: "dana@acme.com",
  name: "Dana",
  deactivatedAt: null,
  pendingSsoSetup: false,
};

function repoFor(user: Partial<BetterAuthHookUser> | null = {}): BetterAuthHooksRepository {
  return createApiFixture<BetterAuthHooksRepository>({
    tryFindUserForHooks: async () => (user === null ? null : { ...WORKER, ...user }),
    tryFindOrganizationBySsoDomain: async () => null,
  });
}

/** Only the arrival door is answered: every other collaborator refuses, which
 *  is what says the door is the one thing these two hooks ask. */
function collaboratorsFor(
  admit: SsoArrivalApi["admit"],
  record: SsoAuthenticationActivityApi["record"] = async () => undefined,
): BetterAuthHookCollaborators {
  return {
    federation: createApiFixture<BetterAuthFederation>(),
    invites: createApiFixture<BetterAuthPendingInvite>(),
    announcements: createApiFixture<BetterAuthAnnouncements>(),
    authzGrants: createApiFixture<AuthzGrantsService>(),
    arrivals: createApiFixture<SsoArrivalApi>({ admit }),
    ssoActivity: createApiFixture<SsoAuthenticationActivityApi>({ record }),
  };
}

const OKTA_ACCOUNT = { userId: "user_1", providerId: "conn_okta", accountId: "okta|dana" };

describe("a sign-in that creates an account through an identity provider", () => {
  it("asks the connection that provider names whether the person is admitted", async () => {
    const admit = vi.fn().mockResolvedValue(undefined);

    await afterAccountCreate({
      repo: repoFor(),
      account: OKTA_ACCOUNT,
      collaborators: collaboratorsFor(admit),
    });

    expect(admit).toHaveBeenCalledWith({
      user: { id: "user_1", email: "dana@acme.com", name: "Dana" },
      connectionId: "conn_okta",
      domain: "acme.com",
    });
  });

  it("records the sign-in against the connection that provider names", async () => {
    const record = vi.fn().mockResolvedValue(undefined);

    await afterAccountCreate({
      repo: repoFor(),
      account: OKTA_ACCOUNT,
      collaborators: collaboratorsFor(async () => undefined, record),
    });

    expect(record).toHaveBeenCalledWith({ connectionId: "conn_okta", userId: "user_1" });
  });

  it("names a person who has no name at all as the empty string", async () => {
    const admit = vi.fn().mockResolvedValue(undefined);

    await afterAccountCreate({
      repo: repoFor({ name: null }),
      account: OKTA_ACCOUNT,
      collaborators: collaboratorsFor(admit),
    });

    expect(admit).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ name: "" }) }),
    );
  });

  it("asks nobody for a password account, which no connection ever admits", async () => {
    const admit = vi.fn().mockResolvedValue(undefined);

    await afterAccountCreate({
      repo: repoFor(),
      account: { ...OKTA_ACCOUNT, providerId: "credential" },
      collaborators: collaboratorsFor(admit),
    });

    expect(admit).not.toHaveBeenCalled();
  });

  it("asks nobody when the address carries no domain to decide on", async () => {
    const admit = vi.fn().mockResolvedValue(undefined);

    await afterAccountCreate({
      repo: repoFor({ email: "dana" }),
      account: OKTA_ACCOUNT,
      collaborators: collaboratorsFor(admit),
    });

    expect(admit).not.toHaveBeenCalled();
  });

  it("keeps the sign-in when the arrival door itself fails", async () => {
    const repo = repoFor();
    const admit = vi.fn().mockRejectedValue(new Error("identity is down"));

    await expect(
      afterAccountCreate({
        repo,
        account: OKTA_ACCOUNT,
        collaborators: collaboratorsFor(admit),
      }),
    ).resolves.toBeUndefined();
  });
});

describe("a returning sign-in, which creates no account row", () => {
  it("asks the connection again although nothing about the person is pending", async () => {
    const admit = vi.fn().mockResolvedValue(undefined);

    await afterAccountUpdate({
      repo: repoFor({ pendingSsoSetup: false }),
      account: OKTA_ACCOUNT,
      collaborators: collaboratorsFor(admit),
    });

    expect(admit).toHaveBeenCalledWith({
      user: { id: "user_1", email: "dana@acme.com", name: "Dana" },
      connectionId: "conn_okta",
      domain: "acme.com",
    });
  });

  it("asks nobody when the sign-in names no person this process holds", async () => {
    const admit = vi.fn().mockResolvedValue(undefined);

    await afterAccountUpdate({
      repo: repoFor(null),
      account: OKTA_ACCOUNT,
      collaborators: collaboratorsFor(admit),
    });

    expect(admit).not.toHaveBeenCalled();
  });
});
