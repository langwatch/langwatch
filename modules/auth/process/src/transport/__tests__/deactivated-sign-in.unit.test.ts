import {
  deriveSessionAmr,
  type IdentityApi,
  NO_SESSION_CLAIMS,
  type SessionClaimsMintInput,
  type SsoMigrationAuthenticationDecision,
} from "@langwatch/identity-contract";
/**
 * @vitest-environment node
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant, toDate, type Instant } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import type { BetterAuthHookCollaborators } from "../../channels/http/http.better-auth-hooks.channel.ts";
import { createBeforeSessionCreateHook } from "../../channels/http/http.better-auth-hooks.channel.ts";
import { SessionCallbackEvidenceChannel } from "../../channels/http/http.session-callback-evidence.channel.ts";
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
    emailVerified: true,
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

/** The session row better-auth hands the hook, for one user. */
function sessionFor(userId: string) {
  const now = toDate(nowInstant());
  return {
    id: "session-1",
    userId,
    token: "token-1",
    expiresAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

const CONTINUING = collaboratorsAnswering({ action: "continue" });

/** Identity's mint answer stood in: the path's local proofs and the given identifier. */
function identityAnswering(identifierId: string | null) {
  const asked: SessionClaimsMintInput[] = [];
  const identity = createApiFixture<IdentityApi>({
    claimsForMint: async (input) => {
      asked.push(input);
      const local =
        input.path === "/sign-in/email" ||
        input.path.startsWith("/passkey") ||
        input.path.startsWith("/two-factor");
      return { identifierId, amr: local ? deriveSessionAmr({ path: input.path }) : [] };
    },
  });
  return { identity, asked };
}

const NO_CLAIMS = {
  identity: createApiFixture<IdentityApi>({ claimsForMint: async () => NO_SESSION_CLAIMS }),
  evidence: SessionCallbackEvidenceChannel.create(),
};

describe("the before-session-create hook", () => {
  describe("given a user account with a non-null deactivatedAt", () => {
    describe("when a session is about to be created for them", () => {
      /** @scenario "Deactivated user is blocked from signing in" */
      /** @scenario "Deactivated user is blocked" */
      it("denies the sign-in", async () => {
        const { repo } = repoAnswering(nowInstant());

        await expect(
          createBeforeSessionCreateHook({
            sessionClaims: NO_CLAIMS,
            repo,
            collaborators: CONTINUING,
          })(sessionFor("user-1"), null),
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
          createBeforeSessionCreateHook({
            sessionClaims: NO_CLAIMS,
            repo,
            collaborators: CONTINUING,
          })(sessionFor("user-1"), null),
        ).resolves.toBeUndefined();
        expect(getUserForHooks).toHaveBeenCalled();
      });
    });
  });

  describe("given a password sign-up still awaiting its emailed proof", () => {
    describe("when its correct password is about to mint a session", () => {
      /** @scenario "Pending password sign-in cannot mint a session" */
      /** @scenario "Client session flags cannot bypass address confirmation" */
      it("refuses the session, and lets it through once the latch is cleared", async () => {
        const pending = repoAnswering(null, true);
        const confirmed = repoAnswering(null, false);
        const attempt = (repo: BetterAuthHooksRepository) =>
          createBeforeSessionCreateHook({
            sessionClaims: NO_CLAIMS,
            repo,
            collaborators: CONTINUING,
          })(sessionFor("user-1"), null);

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
          createBeforeSessionCreateHook({
            sessionClaims: NO_CLAIMS,
            repo,
            collaborators: collaboratorsAnswering({
              action: "reject",
              code: "SSO_LEGACY_AUTH_RETIRED",
            }),
          })(sessionFor("user-1"), null),
        ).rejects.toMatchObject({ body: { code: "SSO_LEGACY_AUTH_RETIRED" } });
      });
    });
  });

  describe("given a sign-in about to mint a session", () => {
    type MintContext = NonNullable<Parameters<ReturnType<typeof createBeforeSessionCreateHook>>[1]>;
    const mintOn = (path: string) =>
      createBeforeSessionCreateHook({
        sessionClaims: { identity: identityAnswering(null).identity, evidence: NO_CLAIMS.evidence },
        repo: repoAnswering(null).repo,
        collaborators: CONTINUING,
      })(sessionFor("user-1"), createApiFixture<MintContext>({ path }));

    it("records what a password, a two-step code or a passkey proved", async () => {
      await expect(mintOn("/sign-in/email")).resolves.toMatchObject({ data: { amr: ["pwd"] } });
      await expect(mintOn("/two-factor/verify-totp")).resolves.toMatchObject({
        data: { amr: ["pwd", "otp"] },
      });
      await expect(mintOn("/passkey/verify-authentication")).resolves.toMatchObject({
        data: { amr: ["phw"] },
      });
    });

    it("records nothing for a federated callback, whose factors need a verified token", async () => {
      await expect(mintOn("/callback/auth0")).resolves.toBeUndefined();
    });

    describe("when a SAML callback in this request accepted an exact provider account", () => {
      const ACS = "/sso/saml2/sp/acs/acme-saml";
      const accountRow = {
        id: "acct_row_1",
        providerId: "acme-saml",
        accountId: "ada-subject",
        createdAt: new Date("2026-10-06T10:00:00Z"),
      };
      const mintThroughCallback = async ({ rows }: { rows: (typeof accountRow)[] }) => {
        const evidence = SessionCallbackEvidenceChannel.create();
        const { identity, asked } = identityAnswering("idf_saml");
        const context = createApiFixture<MintContext>({
          path: ACS,
          context: {
            internalAdapter: {
              findAccounts: async () => rows,
              findUserById: async () => ({ email: "ada@acme.test" }),
            },
          } as never,
        });
        const minted = await evidence.runWithScope(async () => {
          evidence.recordAuthenticatedSsoAccount({
            providerId: "acme-saml",
            providerAccountId: "ada-subject",
          });
          return createBeforeSessionCreateHook({
            sessionClaims: { identity, evidence },
            repo: repoAnswering(null).repo,
            collaborators: CONTINUING,
          })(sessionFor("user-1"), context);
        });
        return { minted, asked };
      };

      it("records the identifier identity attributes it to, with the transaction's account", async () => {
        const { minted, asked } = await mintThroughCallback({ rows: [accountRow] });

        expect(minted).toMatchObject({ data: { identifierId: "idf_saml", amr: [] } });
        expect(asked).toEqual([
          {
            userId: "user-1",
            path: ACS,
            callback: {
              providerAccountId: "ada-subject",
              assertedFactors: [],
              verifiedTokenClaims: false,
              account: {
                accountId: "acct_row_1",
                createdAtMs: accountRow.createdAt.getTime(),
                email: "ada@acme.test",
              },
            },
          },
        ]);
      });

      it("hands identity no account to derive from when the subject has several rows", async () => {
        const { asked } = await mintThroughCallback({
          rows: [accountRow, { ...accountRow, id: "acct_row_2" }],
        });

        expect(asked[0]?.callback).not.toHaveProperty("account");
      });
    });

    it("asks identity without evidence when no callback in this request accepted an account", async () => {
      const { identity, asked } = identityAnswering(null);
      await createBeforeSessionCreateHook({
        sessionClaims: { identity, evidence: NO_CLAIMS.evidence },
        repo: repoAnswering(null).repo,
        collaborators: CONTINUING,
      })(
        sessionFor("user-1"),
        createApiFixture<MintContext>({ path: "/sso/saml2/sp/acs/acme-saml" }),
      );

      expect(asked).toEqual([{ userId: "user-1", path: "/sso/saml2/sp/acs/acme-saml" }]);
    });
  });
});
