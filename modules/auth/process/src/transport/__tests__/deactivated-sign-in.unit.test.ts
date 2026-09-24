/**
 * @vitest-environment node
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { SsoMigrationAuthenticationDecision } from "@langwatch/identity-contract";
import { nowInstant, type Instant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import type { BetterAuthHookCollaborators } from "../../channels/http/http.better-auth-hooks.channel.ts";
import { beforeSessionCreate } from "../../channels/http/http.better-auth-hooks.channel.ts";
import type { BetterAuthHooksRepository } from "../../repositories/better-auth-hooks.repository.ts";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

function repoAnswering(deactivatedAt: Instant | null, signupConfirmationPending = false) {
  const getUserForHooks = vi.fn(async () => ({
    id: "user-1",
    email: "user@example.com",
    name: null,
    deactivatedAt,
    pendingSsoSetup: false,
    signupConfirmationPending,
  }));
  const findFederatedAccountsForUser = vi.fn(async () => [
    { providerId: "auth0", accountId: "waad|acme|sam" },
  ]);
  return {
    repo: createApiFixture<BetterAuthHooksRepository>({
      getUserForHooks,
      findFederatedAccountsForUser,
    }),
    getUserForHooks,
  };
}

/** Only the cutover's answer matters here; anything else a hook reaches for
 *  is refused by name rather than quietly stubbed. */
function collaboratorsAnswering(
  decision: SsoMigrationAuthenticationDecision,
): BetterAuthHookCollaborators {
  return createApiFixture<BetterAuthHookCollaborators>({
    ssoMigration: createApiFixture<BetterAuthHookCollaborators["ssoMigration"]>({
      authorizeAndRecordAuthentication: async () => decision,
    }),
  });
}

const CONTINUING = collaboratorsAnswering({ action: "continue" });

describe("beforeSessionCreate", () => {
  describe("given a user account with a non-null deactivatedAt", () => {
    describe("when a session is about to be created for them", () => {
      /** @scenario "Deactivated user is blocked from signing in" */
      /** @scenario "Deactivated user is blocked" */
      it("denies the sign-in", async () => {
        const { repo } = repoAnswering(nowInstant());

        await expect(
          beforeSessionCreate({
            repo,
            session: { userId: "user-1" },
            path: "/sign-in/email",
            collaborators: CONTINUING,
          }),
        ).resolves.toBe(false);
      });
    });
  });

  describe("given a user account with deactivatedAt null", () => {
    describe("when a session is about to be created for them", () => {
      /** @scenario "Active user is not blocked from signing in" */
      it("leaves the sign-in to continue", async () => {
        const { repo, getUserForHooks } = repoAnswering(null);

        await expect(
          beforeSessionCreate({
            repo,
            session: { userId: "user-1" },
            path: "/sign-in/email",
            collaborators: CONTINUING,
          }),
        ).resolves.toBeUndefined();
        expect(getUserForHooks).toHaveBeenCalled();
      });
    });
  });

  describe("given a password sign-up still awaiting its emailed proof", () => {
    describe("when its correct password is about to mint a session", () => {
      /** @scenario "Pending password sign-in cannot mint a session" */
      it("refuses the session, and lets it through once the latch is cleared", async () => {
        const pending = repoAnswering(null, true);
        const confirmed = repoAnswering(null, false);
        const attempt = (repo: BetterAuthHooksRepository) =>
          beforeSessionCreate({
            repo,
            session: { userId: "user-1" },
            path: "/sign-in/email",
            collaborators: CONTINUING,
          });

        await expect(attempt(pending.repo)).resolves.toBe(false);
        await expect(attempt(confirmed.repo)).resolves.toBeUndefined();
      });
    });
  });

  describe("given a member still linked to a connection the cutover retired", () => {
    describe("when their callback is about to mint a session", () => {
      it("refuses the sign-in with the code the screen reads", async () => {
        const { repo } = repoAnswering(null);

        await expect(
          beforeSessionCreate({
            repo,
            session: { userId: "user-1" },
            path: "/callback/auth0",
            collaborators: collaboratorsAnswering({
              action: "reject",
              code: "SSO_LEGACY_AUTH_RETIRED",
            }),
          }),
        ).rejects.toMatchObject({ body: { code: "SSO_LEGACY_AUTH_RETIRED" } });
      });
    });
  });
});
