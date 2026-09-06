/**
 * The identity branch of the storage adapter (ADR-116 §6), driven by the
 * real `betterAuth()`.
 *
 * The gate is open, so every routed read and write for this user is served
 * from `Identifier` ⋈ `AccountCredential` instead of the `Account` table.
 * What the suite watches for is the split the ADR draws: LINKAGE becomes a
 * fact the ceremonies state and the fold projects, SECRETS become a
 * credential row that no event ever carries, and the id better-auth hands
 * back is the identifier's pinned account id in both directions.
 *
 * No `databaseHooks` are wired. The application still binds them during the
 * bridge phase, but the adapter has to state its own facts, and a suite that
 * wired the hooks could not tell which of the two did it.
 *
 * Hermetic (no database, no network): the ledger folds in memory and
 * better-auth's own `memoryAdapter` stands in for Prisma on the legacy
 * branch and for the `Account` rows the bridge mirror writes.
 */
import { IDENTIFIER_ATTACHED_EVENT_TYPE } from "@langwatch/identity";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { beforeEach, describe, expect, it } from "vitest";
import { IdentityUnsupportedStorageQueryError } from "../better-auth/account-queries";
import type { IdentityStack } from "./support/storage-adapter-stack";
import {
  identityStack,
  NEW_PASSWORD,
  PASSWORD,
  signUp,
} from "./support/storage-adapter-stack";

const EMAIL = "member@acme.com";

type Stack = IdentityStack;

/**
 * The issuer better-auth 1.7 keys an account by, for a provider that declares
 * none of its own.
 *
 * 1.7 re-keyed the account identity from `(providerId, accountId)` to
 * `(issuer, accountId)`, and synthesises this value for every social provider
 * that does not name an issuer. Inlined rather than imported: the builder is
 * exported only from `@better-auth/core/db`, and this package peer-depends on
 * `better-auth` alone — taking the core package as a dependency to reach two
 * lines of string construction would widen the seam for a test's convenience.
 */
const oauthIssuer = (providerId: string): string =>
  `local:oauth:${encodeURIComponent(providerId)}`;

/** better-auth's issuer for its own password method. Note the namespace: an
 *  internal method is `local:<id>`, NOT `local:oauth:<id>`. Getting that
 *  wrong fails the credential filter exactly as a missing value does. */
const CREDENTIAL_ISSUER = "local:credential";

const userIdOf = (stack: Stack): string => stack.db.user?.[0]?.id as string;

/** One user's id when a suite holds more than one of them. */
const idOfUser = (stack: Stack, email: string): string =>
  stack.db.user?.find((row) => row.email === email)?.id as string;

const statedIdentifiers = (stack: Stack) =>
  [...stack.heads.heads.values()].flatMap((heads) =>
    Object.values(heads.identifiers),
  );

const accountRow = (stack: Stack, id: string) =>
  stack.db.account?.find((row) => row.id === id);

/**
 * The `Account` row the fold maintains during the bridge phase. The memory
 * engine has no fold behind it, so a suite that wants to watch the mirror
 * puts the row there itself.
 *
 * The issuer is not decoration. better-auth 1.7 finds a credential account by
 * `(providerId, issuer, accountId)` and nothing else, so a bridge row without
 * it is invisible to the legacy branch — which reads to the customer as a
 * wrong password. This row carries what the fold's `upsertLiveAccount`
 * writes, because the whole point of the row is to be what the fold left
 * behind.
 */
function seedBridgeRow(stack: Stack, accountId: string): void {
  stack.db.account?.push({
    id: accountId,
    userId: userIdOf(stack),
    providerId: "credential",
    issuer: CREDENTIAL_ISSUER,
    accountId: userIdOf(stack),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe("better-auth over the identity storage adapter", () => {
  describe("given a user whose identifier backfill has finalized", () => {
    let stack: Stack;

    beforeEach(() => {
      stack = identityStack();
      stack.gate.open = () => true;
    });

    describe("when the whole flow runs on the identity branch", () => {
      /** @scenario "The end-to-end suite is the upgrade net" */
      it("signs up, signs in joined, lists, changes a password, links and deletes", async () => {
        const cookie = await signUp(stack.auth, EMAIL);
        const headers = new Headers({ cookie });
        const userId = userIdOf(stack);
        const context = await stack.auth.$context;
        // Nothing in the legacy table: every operation below is answered by
        // the identity branch or it is not answered at all.
        stack.db.account = [];

        expect(
          (await stack.auth.api.signInEmail({
            body: { email: EMAIL, password: PASSWORD },
          })).user.email,
        ).toBe(EMAIL);
        expect(await stack.auth.api.listUserAccounts({ headers })).toHaveLength(
          1,
        );

        await stack.auth.api.changePassword({
          body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
          headers,
        });
        expect(
          (await stack.auth.api.signInEmail({
            body: { email: EMAIL, password: NEW_PASSWORD },
          })).user.email,
        ).toBe(EMAIL);

        await context.internalAdapter.linkAccount({
          userId,
          providerId: "google",
          issuer: oauthIssuer("google"),
          accountId: "sub-google-1",
        });
        expect(
          (await context.internalAdapter.findAccounts(userId)).map(
            (row) => row.providerId,
          ).sort(),
        ).toEqual(["credential", "google"]);

        await context.internalAdapter.deleteUser(userId);

        expect(stack.db.user).toHaveLength(0);
        expect(stack.storage.credentials.size).toBe(0);
        expect(stack.db.account).toHaveLength(0);
      });

      /** @scenario "Sessions and verifications take the stock branch for everyone" */
      it("writes a session and a verification through the legacy branch, stating nothing", async () => {
        const cookie = await signUp(stack.auth, EMAIL);
        const statedBySignUp = stack.commands.length;
        const context = await stack.auth.$context;

        await context.internalAdapter.createVerificationValue({
          identifier: "verify-me",
          value: "proof",
          expiresAt: new Date(Date.now() + 60_000),
        });
        const session = await stack.auth.api.getSession({
          headers: new Headers({ cookie }),
        });

        expect(session?.user.email).toBe(EMAIL);
        expect(stack.db.session).toHaveLength(1);
        expect(stack.db.verification).toHaveLength(1);
        expect(stack.commands).toHaveLength(statedBySignUp);
      });
    });

    describe("when an account is created", () => {
      /** @scenario "A latched user's account create states the fact instead of owning the row" */
      it("states the attach, writes the credential, and keeps secrets out of the payload", async () => {
        await signUp(stack.auth, EMAIL);

        expect(stack.commands.map((command) => command.type)).toEqual([
          "lw.identity.attach_identifier",
        ]);
        const [identifier] = statedIdentifiers(stack);
        expect(identifier).toMatchObject({
          provider: "credential",
          value: EMAIL,
          state: "VERIFIED",
        });

        // The secrets landed in the credential row, keyed by the id the
        // ceremony pinned — which is the identifier's own accountId.
        const credential = stack.storage.credentials.get(
          identifier?.accountId as string,
        );
        expect(credential?.secrets.password).toEqual(expect.any(String));

        // ADR-101's payload rule: nothing a command carried is a secret.
        expect(JSON.stringify(stack.commands)).not.toContain(
          credential?.secrets.password,
        );
      });
    });

    describe("when a secret is written while the Account bridge still exists", () => {
      /** @scenario "Bridge mirroring keeps the fail-closed direction safe" */
      it("mirrors it onto the Account row, so a later gate outage still verifies it", async () => {
        const cookie = await signUp(stack.auth, EMAIL);
        const [identifier] = statedIdentifiers(stack);
        const accountId = identifier?.accountId as string;
        seedBridgeRow(stack, accountId);

        await stack.auth.api.changePassword({
          body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
          headers: new Headers({ cookie }),
        });

        expect(accountRow(stack, accountId)?.password).toBe(
          stack.storage.credentials.get(accountId)?.secrets.password,
        );

        // The gate closes — a rollback, or a cache it cannot read — and the
        // user falls back to the legacy branch. The mirror is what keeps that
        // fallback from rejecting the password they just set.
        stack.gate.open = () => false;
        const signedIn = await stack.auth.api.signInEmail({
          body: { email: EMAIL, password: NEW_PASSWORD },
        });
        expect(signedIn.user.email).toBe(EMAIL);
      });
    });

    describe("when the user signs in with the account join", () => {
      /** @scenario "The joined sign-in read is served from the identity tables" */
      it("serves the fallback join from its own findMany and verifies the credential row's password", async () => {
        await signUp(stack.auth, EMAIL);
        // Emptying the legacy table is what makes the claim testable: if the
        // fallback join were served from anywhere but this adapter's own
        // findMany, sign-in would now fail.
        stack.db.account = [];

        const signedIn = await stack.auth.api.signInEmail({
          body: { email: EMAIL, password: PASSWORD },
        });

        expect(signedIn.user.email).toBe(EMAIL);
      });

      /** @scenario "Sign-in resolves by any verified email, not only the primary" */
      it("resolves a verified secondary address to the same user", async () => {
        await signUp(stack.auth, EMAIL);
        attachVerifiedAlias(stack, {
          userId: userIdOf(stack),
          value: "sam@home.net",
        });
        stack.db.account = [];

        const signedIn = await stack.auth.api.signInEmail({
          body: { email: "sam@home.net", password: PASSWORD },
        });

        // The user record still presents the address `User.email` holds:
        // user-model reads are never routed, only which row they resolve to.
        expect(signedIn.user.email).toBe(EMAIL);
      });

      /** @scenario "Resolution reads do not depend on the gate cache" */
      it("resolves a secondary address with the gate closed and still signs in", async () => {
        const cookie = await signUp(stack.auth, EMAIL);
        const [identifier] = statedIdentifiers(stack);
        seedBridgeRow(stack, identifier?.accountId as string);
        // One secret write puts the password on the bridge row, which is what
        // the fold and the forward mirror leave behind in production.
        await stack.auth.api.changePassword({
          body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
          headers: new Headers({ cookie }),
        });
        attachVerifiedAlias(stack, {
          userId: userIdOf(stack),
          value: "sam@home.net",
        });

        // The gate cannot be read, so it answers closed for every write and
        // every account read. Resolution does not ask it — it joins the
        // migration-state row into its own query, and that row still says
        // finalized — so the address still names the user, and the legacy
        // branch serves them from there.
        stack.finalized.is = () => true;
        stack.gate.open = () => false;

        const signedIn = await stack.auth.api.signInEmail({
          body: { email: "sam@home.net", password: NEW_PASSWORD },
        });
        expect(signedIn.user.email).toBe(EMAIL);
      });

      /** @scenario "A plus-addressed sign-in still resolves after the latch" */
      it("normalizes the query value the way the attach did, so a working sign-in does not go dark", async () => {
        // Before the latch: `User.email` IS the plus address, and
        // better-auth's own lowercase-and-nothing-else finds it.
        const unlatched = identityStack();
        await signUp(unlatched.auth, "sam.j+news@acme.com");
        expect(
          (await unlatched.auth.api.signInEmail({
            body: { email: "Sam.J+news@Acme.com", password: PASSWORD },
          })).user.email,
        ).toBe("sam.j+news@acme.com");

        // After it: the identifier holds the D01-normalized value, so the
        // same address only resolves if the branch normalizes the query too.
        // The case is folded and the TAG SURVIVES (6b62a98725): the tag is
        // part of the address, so this stays a different mailbox from
        // `sam.j@acme.com` rather than being merged onto it.
        await signUp(stack.auth, "sam.j+news@acme.com");
        expect(statedIdentifiers(stack)[0]?.value).toBe("sam.j+news@acme.com");
        stack.db.account = [];

        const signedIn = await stack.auth.api.signInEmail({
          body: { email: "Sam.J+news@Acme.com", password: PASSWORD },
        });
        expect(signedIn.user.email).toBe("sam.j+news@acme.com");
      });
    });

    describe("when an IdP callback names a provider subject", () => {
      /** @scenario "The OAuth callback resolves the provider subject through the identity tables" */
      it("resolves the user from the projection and completes the joined user read", async () => {
        await signUp(stack.auth, EMAIL);
        const userId = userIdOf(stack);
        const context = await stack.auth.$context;
        await context.internalAdapter.linkAccount({
          userId,
          providerId: "google",
          issuer: oauthIssuer("google"),
          accountId: "g-123",
        });
        stack.db.account = [];

        const resolved = await context.internalAdapter.findAccountOwnerByKey({
          issuer: oauthIssuer("google"),
          accountId: "g-123",
        });

        expect(resolved?.kind).toBe("owned");
        expect(
          resolved?.kind === "owned" ? resolved.user.id : null,
        ).toBe(userId);
        expect(resolved?.account.providerId).toBe("google");

        // A held user — the projection holds them, the gate does not open —
        // falls through to the legacy branch, which is still their truth.
        stack.gate.open = () => false;
        expect(
          await context.internalAdapter.findAccountByKey({
            issuer: oauthIssuer("google"),
            accountId: "g-123",
          }),
        ).toBeNull();
      });
    });

    describe("when the account key names a real issuer", () => {
      /**
       * The issuer a provider brings itself. Google's is this URL, and it is
       * hardcoded in better-auth's own provider rather than configurable, so
       * `local:oauth:google` — what a derivation from the provider id would
       * produce — is simply the wrong key for a Google account.
       */
      const GOOGLE_ISSUER = "https://accounts.google.com";

      /** @scenario "An attach states the issuer better-auth decided" */
      it("states the issuer verbatim rather than one derived from the provider id", async () => {
        await signUp(stack.auth, EMAIL);
        const userId = userIdOf(stack);
        const before = stack.commands.length;

        await (
          await stack.auth.$context
        ).internalAdapter.linkAccount({
          userId,
          providerId: "google",
          issuer: GOOGLE_ISSUER,
          accountId: "sub-google-1",
        });

        const google = statedIdentifiers(stack).find(
          (identifier) => identifier.providerId === "google",
        );
        expect(google?.issuer).toBe(GOOGLE_ISSUER);
        // The derivation would have produced this instead, and it is what a
        // fact that computed its own issuer would carry.
        expect(google?.issuer).not.toBe(oauthIssuer("google"));
        expect(
          stack.commands.slice(before).map((command) => command.type),
        ).toContain("lw.identity.attach_identifier");
      });

      /** @scenario "A stored issuer is served in preference to a derived one" */
      it("serves the stored issuer back to better-auth, not the synthetic form", async () => {
        await signUp(stack.auth, EMAIL);
        const userId = userIdOf(stack);
        const context = await stack.auth.$context;
        await context.internalAdapter.linkAccount({
          userId,
          providerId: "google",
          issuer: GOOGLE_ISSUER,
          accountId: "sub-google-1",
        });
        // Nothing in the legacy table, so the row below is the identity
        // branch's answer or there is no answer at all.
        stack.db.account = [];

        const listed = await context.internalAdapter.findAccounts(userId);

        const google = listed.find((row) => row.providerId === "google");
        expect(google?.issuer).toBe(GOOGLE_ISSUER);
      });

      /** @scenario "An identifier attached without an issuer still answers better-auth" */
      it("falls back to the synthetic issuer for an identifier stated before one was carried", async () => {
        await signUp(stack.auth, EMAIL);
        const userId = userIdOf(stack);
        const context = await stack.auth.$context;
        await context.internalAdapter.linkAccount({
          userId,
          providerId: "google",
          issuer: GOOGLE_ISSUER,
          accountId: "sub-google-1",
        });
        // The shape of a fact stated before ADR-116 carried an issuer. The
        // row still has to come back with one, or 1.7 cannot key it at all.
        const google = statedIdentifiers(stack).find(
          (identifier) => identifier.providerId === "google",
        );
        stack.heads.fold(userId, []);
        const head = stack.heads.heads.get(userId);
        if (head && google) {
          head.identifiers[google.identifierId] = {
            ...google,
            issuer: null,
          };
        }
        stack.db.account = [];

        const listed = await context.internalAdapter.findAccounts(userId);

        expect(
          listed.find((row) => row.providerId === "google")?.issuer,
        ).toBe(oauthIssuer("google"));
      });
    });

    describe("when the accounts are listed and unlinked", () => {
      /** @scenario "Unlink on the identity branch detaches the fact and the secrets together" */
      it("lists accounts by their pinned id and detaches the one it is given back", async () => {
        await signUp(stack.auth, EMAIL);
        const userId = userIdOf(stack);
        const context = await stack.auth.$context;
        await context.internalAdapter.linkAccount({
          userId,
          providerId: "google",
          issuer: oauthIssuer("google"),
          accountId: "sub-google-1",
        });

        const listed = await context.internalAdapter.findAccounts(userId);
        const pinned = statedIdentifiers(stack).map(
          (identifier) => identifier.accountId,
        );
        expect(listed.map((row) => row.id).sort()).toEqual(pinned.sort());

        const google = listed.find((row) => row.providerId === "google");
        // The bridge row the mirror has been keeping this method's secrets
        // on. While it stands, the fail-closed fallback to the legacy branch
        // can still authenticate with them.
        seedBridgeRow(stack, google?.id as string);
        await context.internalAdapter.deleteAccount(google?.id as string);

        expect(stack.commands.map((command) => command.type)).toContain(
          "lw.identity.detach_identifier",
        );
        expect(
          statedIdentifiers(stack).find(
            (identifier) => identifier.accountId === google?.id,
          )?.state,
        ).toBe("DETACHED");
        expect(stack.storage.credentials.has(google?.id as string)).toBe(false);
        expect(accountRow(stack, google?.id as string)).toBeUndefined();
        const remaining = await context.internalAdapter.findAccounts(userId);
        expect(remaining.map((row) => row.providerId)).toEqual(["credential"]);
      });
    });

    describe("when the user holding one way in is erased", () => {
      /**
       * The regression this pairing produced: better-auth deletes a user by
       * fanning an account delete out per row BEFORE `user.delete.before`
       * runs, so every row met the detach guards — which exist to stop
       * somebody unlinking their last method and locking themselves out.
       * Nobody is locked out of an account that is being erased, so a user
       * holding a single sign-in method could not be deleted at all.
       */
      /** @scenario "Erasing a user removes the one way in they hold" */
      it("erases them, rather than refusing to strand the person being erased", async () => {
        await signUp(stack.auth, EMAIL);
        const userId = userIdOf(stack);
        const context = await stack.auth.$context;
        const [identifier] = statedIdentifiers(stack);
        // The one method they hold, and it is verified — precisely the shape
        // the strands guard refuses to remove from a LIVING user.
        expect(statedIdentifiers(stack)).toHaveLength(1);
        expect(identifier?.state).toBe("VERIFIED");

        await context.internalAdapter.deleteUser(userId);

        expect(stack.db.user).toHaveLength(0);
        expect(stack.storage.credentials.size).toBe(0);
        // Never a detach per row: that is what asked the guard, and it would
        // also say the same removal twice. The erase itself is stated by
        // `beforeUserDelete`, which this suite deliberately leaves unwired —
        // the adapter has to be right on its own (see the file header).
        expect(stack.commands.map((command) => command.type)).not.toContain(
          "lw.identity.detach_identifier",
        );
      });

      /**
       * The other half, and the reason the fix is scoped to the erase rather
       * than to the guard: unlinking that same last method from a user who is
       * staying must still be refused.
       */
      /** @scenario "Unlinking the last way in is still refused for a living user" */
      it("still refuses to unlink that same method while the user stays", async () => {
        await signUp(stack.auth, EMAIL);
        const context = await stack.auth.$context;
        const [identifier] = statedIdentifiers(stack);
        const accountId = identifier?.accountId as string;

        await expect(
          context.internalAdapter.deleteAccount(accountId),
        ).rejects.toMatchObject({
          body: { code: "identity_detach_strands_user" },
        });

        // Still theirs, and still a way in.
        expect(
          statedIdentifiers(stack).find(
            (candidate) => candidate.accountId === accountId,
          )?.state,
        ).toBe("VERIFIED");
        expect(
          (await stack.auth.api.signInEmail({
            body: { email: EMAIL, password: PASSWORD },
          })).user.email,
        ).toBe(EMAIL);
      });
    });

    describe("when better-auth issues an account query with an unenumerated operator", () => {
      /** @scenario "An operator the branch has not enumerated never reads as an equality" */
      it("refuses rather than reading `ne` as an equality and deleting the row it spared", async () => {
        await signUp(stack.auth, EMAIL);
        const userId = userIdOf(stack);
        const context = await stack.auth.$context;
        await context.internalAdapter.linkAccount({
          userId,
          providerId: "google",
          issuer: oauthIssuer("google"),
          accountId: "sub-google-1",
        });
        const kept = (await context.internalAdapter.findAccounts(userId))[0];

        await expect(
          context.adapter.delete({
            model: "account",
            where: [{ field: "id", value: kept?.id as string, operator: "ne" }],
          }),
        ).rejects.toMatchObject({
          body: { code: "identity_unsupported_storage_query" },
        });

        // Both sign-in methods survive: the refusal is what stops a query
        // meaning "every row except this one" from removing exactly that one.
        expect(await context.internalAdapter.findAccounts(userId)).toHaveLength(
          2,
        );
      });
    });

    describe("when a token refresh rewrites the secrets", () => {
      /** @scenario "A token refresh writes a credential row and states nothing" */
      it("updates the credential row in place and leaves the projection alone", async () => {
        await signUp(stack.auth, EMAIL);
        const userId = userIdOf(stack);
        const context = await stack.auth.$context;
        await context.internalAdapter.linkAccount({
          userId,
          providerId: "google",
          issuer: oauthIssuer("google"),
          accountId: "sub-google-1",
        });
        const google = (await context.internalAdapter.findAccounts(userId)).find(
          (row) => row.providerId === "google",
        );
        const statedBefore = stack.commands.length;
        const identifiersBefore = statedIdentifiers(stack);

        await context.internalAdapter.updateAccount(google?.id as string, {
          accessToken: "at-2",
          refreshToken: "rt-2",
        });

        expect(stack.commands).toHaveLength(statedBefore);
        // Nothing the fold would replay changed, which is the other half of
        // the claim: a replay rebuilds these identifiers and never touches
        // the credential row.
        expect(statedIdentifiers(stack)).toEqual(identifiersBefore);
        expect(
          stack.storage.credentials.get(google?.id as string)?.secrets,
        ).toMatchObject({ accessToken: "at-2", refreshToken: "rt-2" });
      });
    });

    describe("when the sign-in token refresh restates the account's own provider", () => {
      /** @scenario "A sign-in that echoes the account's own provider back is served, not refused" */
      it("writes the tokens instead of refusing the echo", async () => {
        await signUp(stack.auth, EMAIL);
        const userId = userIdOf(stack);
        const context = await stack.auth.$context;
        await context.internalAdapter.linkAccount({
          userId,
          providerId: "google",
          issuer: oauthIssuer("google"),
          accountId: "sub-google-1",
        });
        const google = (await context.internalAdapter.findAccounts(userId)).find(
          (row) => row.providerId === "google",
        );
        const statedBefore = stack.commands.length;

        // better-auth 1.7's `oauth2/link-account` sends `providerId` in the
        // same payload as the rotated tokens, echoing back the value it just
        // read. 1.6 did not, and refusing the echo failed every OAuth
        // sign-in for a latched user.
        await context.adapter.update({
          model: "account",
          where: [{ field: "id", value: google?.id as string }],
          update: {
            providerId: "google",
            accessToken: "at-2",
            refreshToken: "rt-2",
          },
        });

        expect(
          stack.storage.credentials.get(google?.id as string)?.secrets,
        ).toMatchObject({ accessToken: "at-2", refreshToken: "rt-2" });
        // The restated provider wrote nothing: linkage is still the fold's,
        // so no command was stated for it.
        expect(stack.commands).toHaveLength(statedBefore);
      });

      /** @scenario "A sign-in that changes the account's provider is still refused" */
      it("still refuses a provider that differs from the row it names", async () => {
        await signUp(stack.auth, EMAIL);
        const userId = userIdOf(stack);
        const context = await stack.auth.$context;
        await context.internalAdapter.linkAccount({
          userId,
          providerId: "google",
          issuer: oauthIssuer("google"),
          accountId: "sub-google-1",
        });
        const google = (await context.internalAdapter.findAccounts(userId)).find(
          (row) => row.providerId === "google",
        );

        // Equality is the whole safety argument: an echo writes nothing, but
        // a DIFFERENT provider is a real linkage rewrite and would repoint
        // the row at another IdP.
        await expect(
          context.adapter.update({
            model: "account",
            where: [{ field: "id", value: google?.id as string }],
            update: { providerId: "github", accessToken: "at-2" },
          }),
        ).rejects.toMatchObject({
          body: { code: "identity_unsupported_storage_query" },
        });

        expect(
          (await context.internalAdapter.findAccounts(userId)).find(
            (row) => row.id === google?.id,
          )?.providerId,
        ).toBe("google");
      });
    });

    describe("when better-auth's own sign-in path refreshes an OAuth account", () => {
      /** @scenario "A sign-in that echoes the account's own provider back is served, not refused" */
      it("completes the sign-in better-auth 1.7 actually issues", async () => {
        await signUp(stack.auth, EMAIL);
        const userId = userIdOf(stack);
        const context = await stack.auth.$context;
        await context.internalAdapter.linkAccount({
          userId,
          providerId: "google",
          issuer: oauthIssuer("google"),
          accountId: "sub-google-1",
        });
        const google = (await context.internalAdapter.findAccounts(userId)).find(
          (row) => row.providerId === "google",
        );

        // better-auth's OWN payload, not one this test hand-builds: 1.7's
        // `handleOAuthUserInfo` is where the sign-in token refresh is
        // constructed, and it is what added `providerId` beside the tokens.
        // Driving it here is the difference between pinning the fix and
        // pinning this test's guess about the fix.
        const result = await handleOAuthUserInfo(
          { context } as unknown as Parameters<typeof handleOAuthUserInfo>[0],
          {
            userInfo: {
              id: "sub-google-1",
              email: EMAIL,
              emailVerified: true,
              name: "Sam",
              image: null,
            },
            account: {
              providerId: "google",
              issuer: oauthIssuer("google"),
              accountId: "sub-google-1",
              accessToken: "at-rotated",
              refreshToken: "rt-rotated",
            },
          },
        );

        // A refusal reaches here as a throw, so arriving at all is half the
        // claim; the session is the other half — this is a completed
        // sign-in, not merely an update that did not explode.
        expect(result.error).toBeFalsy();
        expect(result.data?.session).toBeDefined();
        expect(
          stack.storage.credentials.get(google?.id as string)?.secrets,
        ).toMatchObject({
          accessToken: "at-rotated",
          refreshToken: "rt-rotated",
        });
      });
    });

    describe("when better-auth updates the user's email", () => {
      /** @scenario "An email change on the identity branch is a command, not a column write" */
      it("dispatches it as an identity command and leaves User.email to the fold", async () => {
        await signUp(stack.auth, EMAIL);
        const userId = userIdOf(stack);
        const context = await stack.auth.$context;

        await context.adapter.update({
          model: "user",
          where: [{ field: "id", value: userId }],
          update: { email: "sam@home.net" },
        });

        // Stated, not written. The address is now an ATTACHED identifier —
        // unverified, so not yet anybody's `User.email`, which is the honest
        // answer: nobody has proved this mailbox.
        expect(
          stack.commands
            .filter((command) => command.type === "lw.identity.attach_identifier")
            .map((command) => (command.data as { value: string }).value),
        ).toContain("sam@home.net");
        expect(
          statedIdentifiers(stack).find(
            (identifier) => identifier.value === "sam@home.net",
          )?.state,
        ).toBe("ATTACHED");

        // The column is untouched: `User.email` has one writer on this
        // branch, and it is the fold, from the PRIMARY identifier.
        expect(stack.db.user?.[0]?.email).toBe(EMAIL);
      });

      it("passes a user update carrying no email through unchanged", async () => {
        await signUp(stack.auth, EMAIL);
        const userId = userIdOf(stack);
        const statedBefore = stack.commands.length;
        const context = await stack.auth.$context;

        await context.adapter.update({
          model: "user",
          where: [{ field: "id", value: userId }],
          update: { name: "Samantha" },
        });

        expect(stack.db.user?.[0]?.name).toBe("Samantha");
        expect(stack.commands).toHaveLength(statedBefore);
      });

      it("writes the column for an unlatched user, exactly as before", async () => {
        await signUp(stack.auth, EMAIL);
        const userId = userIdOf(stack);
        stack.gate.open = () => false;
        const statedBefore = stack.commands.length;
        const context = await stack.auth.$context;

        await context.adapter.update({
          model: "user",
          where: [{ field: "id", value: userId }],
          update: { email: "sam@home.net" },
        });

        expect(stack.db.user?.[0]?.email).toBe("sam@home.net");
        expect(stack.commands).toHaveLength(statedBefore);
      });
    });

    describe("when better-auth issues an account query the branch has not enumerated", () => {
      /** @scenario "An account query shape the identity branch does not recognize fails loudly" */
      it("refuses with the handled code rather than answering wrongly", async () => {
        await signUp(stack.auth, EMAIL);
        const context = await stack.auth.$context;

        const refused = context.adapter.findMany({
          model: "account",
          where: [
            { field: "userId", value: userIdOf(stack) },
            { field: "scope", value: "openid" },
          ],
        });

        // The boundary translates a handled refusal into better-auth's own
        // error carrying the stable code (ADR-116 §6) — which is what makes
        // it survive better-auth's error paths instead of being flattened
        // into a generic storage failure.
        await expect(refused).rejects.toMatchObject({
          body: { code: "identity_unsupported_storage_query" },
          statusCode: 500,
        });
        const surfaced = await refused.catch(
          (error: { body?: { cause?: unknown } }) => error.body?.cause,
        );
        expect(surfaced).toBeInstanceOf(IdentityUnsupportedStorageQueryError);
        expect(surfaced).toMatchObject({
          code: "identity_unsupported_storage_query",
          fault: "platform",
          // The model and the operator name the failure in the log, through
          // `reasons`, and never in the customer-facing message.
          message: "identity_unsupported_storage_query",
        });

        // Scoped to `account`: the user model is never per-record routed, so
        // an equally unusual user query serves from the User table.
        const users = await context.adapter.findMany({
          model: "user",
          where: [{ field: "name", value: "Sa", operator: "starts_with" }],
        });
        expect(users).toHaveLength(1);
      });

      it("runs the same query on the legacy branch for an unlatched user", async () => {
        await signUp(stack.auth, EMAIL);
        const userId = userIdOf(stack);
        stack.gate.open = () => false;
        const context = await stack.auth.$context;

        const rows = await context.adapter.findMany({
          model: "account",
          where: [
            { field: "userId", value: userId },
            { field: "scope", value: "openid" },
          ],
        });

        expect(rows).toEqual([]);
      });
    });
  });

  describe("given a finalized user holding a verified secondary address", () => {
    let stack: Stack;

    beforeEach(async () => {
      stack = identityStack();
      stack.gate.open = () => true;
      await signUp(stack.auth, EMAIL);
      attachVerifiedAlias(stack, {
        userId: userIdOf(stack),
        value: "sam@home.net",
      });
    });

    describe("when someone else signs up with that address", () => {
      /**
       * The other direction of ADR-116 §6's collision rule, and it needs no
       * guard at all: better-auth's own duplicate check is a
       * `findUserByEmail`, and on this adapter that read resolves through the
       * identifiers. A secondary address exists nowhere in `User.email`, so
       * without the routed read the sign-up would sail past it.
       */
      /** @scenario "A legacy sign-up cannot claim a latched user's verified address" */
      it("is refused as a duplicate address, and no user is created", async () => {
        const before = stack.db.user?.length ?? 0;

        await expect(
          stack.auth.api.signUpEmail({
            body: {
              email: "sam@home.net",
              password: PASSWORD,
              name: "Impostor",
            },
          }),
        ).rejects.toMatchObject({ status: "UNPROCESSABLE_ENTITY" });

        expect(stack.db.user).toHaveLength(before);
      });
    });
  });

  describe("given a user whose backfill is migrated but not finalized", () => {
    let stack: Stack;

    beforeEach(async () => {
      stack = identityStack();
      // A HELD user, built the way one actually arises: her `Account` rows
      // came from the legacy branch and are still authoritative, a backfill
      // pass adopted her identifiers into the projection, and the parity
      // proof then found the two disagreeing — so her state row says
      // `migrated`, and the gate stays shut.
      await signUp(stack.auth, EMAIL);
      attachVerifiedAlias(stack, { userId: userIdOf(stack), value: EMAIL });
      stack.gate.open = () => false;
      stack.finalized.is = () => false;
    });

    describe("when better-auth reads and writes her account data", () => {
      /** @scenario "A held user is served wholly by the legacy branch" */
      it("takes the legacy branch for every operation, projection rows and all", async () => {
        const context = await stack.auth.$context;
        const userId = userIdOf(stack);
        const statedBefore = stack.commands.length;
        const projectionBefore = statedIdentifiers(stack);
        // The identity tables still hold her — that is what makes this a
        // HELD user rather than an unlatched one, and what would make a
        // resolution-first read answer for her if the gate were not asked.
        expect(projectionBefore.length).toBeGreaterThan(0);

        const listed = await context.internalAdapter.findAccounts(userId);
        expect(listed.map((row) => row.providerId)).toEqual(["credential"]);
        expect(listed.map((row) => row.id)).toEqual(
          (stack.db.account ?? []).map((row) => row.id),
        );

        const resolved =
          await context.internalAdapter.findUserByEmail(EMAIL);
        expect(resolved?.user.id).toBe(userId);

        await context.internalAdapter.linkAccount({
          userId,
          providerId: "google",
          issuer: oauthIssuer("google"),
          accountId: "sub-google-1",
        });

        // Nothing was stated and nothing entered identity storage: the next
        // backfill pass heals her projection, not the adapter.
        expect(stack.commands).toHaveLength(statedBefore);
        expect(statedIdentifiers(stack)).toEqual(projectionBefore);
        expect(stack.storage.credentials.size).toBe(0);
        expect(stack.db.account).toHaveLength(2);
      });
    });
  });

  describe("given a finalized user whose gate cache cannot be read", () => {
    let stack: Stack;

    beforeEach(async () => {
      stack = identityStack();
      stack.gate.open = () => true;
      await signUp(stack.auth, EMAIL);
      const [identifier] = statedIdentifiers(stack);
      seedBridgeRow(stack, identifier?.accountId as string);
      // The state row still says finalized — she IS latched. Only the cache
      // in front of the write gate is unreadable, and it fails CLOSED.
      stack.finalized.is = () => true;
      stack.gate.open = () => false;
    });

    describe("when her account rows are written", () => {
      /** @scenario "An unreadable gate cache degrades writes to the legacy branch, never to an error" */
      it("serves every routed write from the legacy branch instead of failing", async () => {
        const context = await stack.auth.$context;
        const userId = userIdOf(stack);
        const statedBefore = stack.commands.length;
        const credentialsBefore = stack.storage.credentials.size;

        await context.internalAdapter.linkAccount({
          userId,
          providerId: "google",
          issuer: oauthIssuer("google"),
          accountId: "sub-google-1",
        });
        const google = (stack.db.account ?? []).find(
          (row) => row.providerId === "google",
        );
        await context.internalAdapter.updateAccount(google?.id as string, {
          accessToken: "at-2",
        });

        // Degraded, not errored: the writes landed, on the branch that is
        // always able to serve them.
        expect(google).toBeDefined();
        expect(
          (stack.db.account ?? []).find((row) => row.id === google?.id)
            ?.accessToken,
        ).toBe("at-2");
        expect(stack.commands).toHaveLength(statedBefore);
        expect(stack.storage.credentials.size).toBe(credentialsBefore);
      });
    });
  });

  describe("given the application's own composition, hooks and adapter together", () => {
    /** @scenario "One writer states a latched user's account attach" */
    it("states exactly one attach for a latched user", async () => {
      const stack = identityStack({ withDatabaseHooks: true });
      stack.gate.open = () => true;

      await signUp(stack.auth, EMAIL);

      // Two collaborators run the same ceremony in one request — the
      // `account.create.before` hook and the adapter. Only the adapter may
      // state the fact, or the second one appends it again whenever the
      // first fold has not landed (ADR-116 §5).
      expect(
        stack.commands.filter(
          (command) => command.type === "lw.identity.attach_identifier",
        ),
      ).toHaveLength(1);
      expect(statedIdentifiers(stack)).toHaveLength(1);
    });

    it("leaves an unlatched user's account create on the legacy branch, hooks and all", async () => {
      const stack = identityStack({ withDatabaseHooks: true, inert: true });

      await signUp(stack.auth, EMAIL);

      expect(stack.commands).toHaveLength(0);
      expect(stack.db.account).toHaveLength(1);
    });
  });

  describe("given one finalized user and one who is not", () => {
    let stack: Stack;

    beforeEach(() => {
      stack = identityStack();
    });

    /**
     * The admin plugin's population-wide reads. They are not per-user
     * routable in the first place — one query, both populations — which is
     * exactly why the `user` model's READS are never routed at all: the
     * `User` table is complete for everyone, because the fold polyfills
     * `email` from the PRIMARY identifier for the users it owns.
     */
    /** @scenario "Admin user searches are never routed" */
    it("serves a name search from the User table, with latched users' primary emails on it", async () => {
      stack.gate.open = () => true;
      await signUp(stack.auth, "sam@acme.com");
      const samId = userIdOf(stack);
      stack.gate.open = (userId) => userId === samId;
      await signUp(stack.auth, "olga@acme.com");
      const context = await stack.auth.$context;

      const found = await context.adapter.findMany<{
        id: string;
        email: string;
      }>({
        model: "user",
        where: [{ field: "name", value: "Sa", operator: "starts_with" }],
      });

      // No `identity_unsupported_storage_query`: that failure is scoped to
      // the `account` model, where per-record routing has to be decidable.
      expect(found.map((row) => row.email).sort()).toEqual([
        "olga@acme.com",
        "sam@acme.com",
      ]);
      expect(
        await context.adapter.count({
          model: "user",
          where: [{ field: "name", value: "Sa", operator: "starts_with" }],
        }),
      ).toBe(2);
    });

    /** @scenario "A read that names no user routes by resolution, then by gate" */
    it("resolves the finalized user through the identifiers and the other through the User table", async () => {
      // Sam signs up latched, so her identifiers exist; Olga signs up with
      // the gate closed and has none.
      stack.gate.open = () => true;
      await signUp(stack.auth, "sam@acme.com");
      stack.gate.open = (userId) => userId === userIdOf(stack);
      await signUp(stack.auth, "olga@acme.com");

      const context = await stack.auth.$context;
      const sam = await context.internalAdapter.findUserByEmail("sam@acme.com");
      const olga =
        await context.internalAdapter.findUserByEmail("olga@acme.com");

      expect(sam?.user.email).toBe("sam@acme.com");
      expect(olga?.user.email).toBe("olga@acme.com");
      // Only Sam's linkage is in the log; Olga's account is a legacy row.
      expect(
        statedIdentifiers(stack).map((identifier) => identifier.value),
      ).toEqual(["sam@acme.com"]);
      expect(stack.db.account).toHaveLength(1);
    });
  });

  /**
   * Enterprise SSO, which is the population D02 moves across and the one
   * shape the end-to-end suites never drove: a latched user whose sign-in
   * method arrived from a generic-OAuth / OIDC provider, signing in through
   * the IdP callback with no legacy `Account` row behind them.
   *
   * The vocabulary is the hazard. `Identifier.provider` folds every
   * enterprise IdP into `oidc` (`identifierProviderFor`), while
   * `Identifier.providerId` keeps better-auth's own id verbatim. What comes
   * back out has to be the verbatim one, or no configured provider would
   * match the row again.
   */
  describe("given a latched user who signs in through an enterprise IdP", () => {
    let stack: Stack;

    beforeEach(() => {
      stack = identityStack();
      stack.gate.open = () => true;
    });

    describe("when the IdP callback names the provider subject", () => {
      /** @scenario "An enterprise SSO sign-in is served from the identity tables" */
      it("resolves the user from the identity tables and answers with the verbatim provider id", async () => {
        await signUp(stack.auth, EMAIL);
        const userId = userIdOf(stack);
        const context = await stack.auth.$context;
        await context.internalAdapter.linkAccount({
          userId,
          providerId: "auth0",
          issuer: oauthIssuer("auth0"),
          accountId: "auth0|abc123",
        });
        // Every legacy row gone: whatever answers below came out of
        // `Identifier` joined to its credential, and nothing else.
        stack.db.account = [];

        const found = await context.internalAdapter.findAccountByKey({
          issuer: oauthIssuer("auth0"),
          accountId: "auth0|abc123",
        });

        expect(found?.userId).toBe(userId);
        // The folded vocabulary must never leak back: `oidc` here would mean
        // no configured provider matches this account again.
        expect(found?.providerId).toBe("auth0");
        expect(found?.accountId).toBe("auth0|abc123");

        // The same lookup through the callback's own entry point, which is
        // what better-auth actually calls when the IdP returns.
        const resolved = await context.internalAdapter.findAccountOwnerByKey({
          issuer: oauthIssuer("auth0"),
          accountId: "auth0|abc123",
        });
        expect(resolved?.kind).toBe("owned");
        expect(
          resolved?.kind === "owned" ? resolved.user.id : null,
        ).toBe(userId);
        expect(resolved?.account.providerId).toBe("auth0");
        // The fact carries the folded vocabulary, so the verbatim id in the
        // answer above came from the row, not from the query echoing back.
        expect(
          statedIdentifiers(stack)
            .filter(
              (identifier) => identifier.providerAccountId === "auth0|abc123",
            )
            .map((identifier) => identifier.provider),
        ).toEqual(["oidc"]);
      });

      /** @scenario "An enterprise SSO sign-in is served from the identity tables" */
      it("tells two enterprise IdPs apart when both fold to the same vocabulary", async () => {
        await signUp(stack.auth, EMAIL);
        const userId = userIdOf(stack);
        const context = await stack.auth.$context;
        await context.internalAdapter.linkAccount({
          userId,
          providerId: "okta",
          issuer: oauthIssuer("okta"),
          accountId: "00u1a2b3c4",
        });
        stack.db.account = [];

        const found = await context.internalAdapter.findAccountByKey({
          issuer: oauthIssuer("okta"),
          accountId: "00u1a2b3c4",
        });

        expect(found?.userId).toBe(userId);
        expect(found?.providerId).toBe("okta");
      });

      /**
       * The cross-tenant sign-in this branch found and fixed. The lookup
       * used to fold `auth0` and `okta` into `oidc` and match on THAT, so
       * two IdPs minting the same subject collapsed onto one identifier and
       * production's `ORDER BY attachedAt ASC LIMIT 1` signed the second
       * customer in as the first. Keyed on the verbatim `providerId` now,
       * the same pair `Account` is unique by, with a partial unique index
       * behind it.
       */
      it("resolves each IdP's subject to its own user when the subject strings collide", async () => {
        // One subject string, two different enterprise IdPs, two different
        // customers. `sub` is only unique WITHIN an issuer, and plenty of
        // OIDC deployments mint small integers, sequential ids or the user's
        // own address - so two tenants sharing one is not exotic.
        await signUp(stack.auth, "sam@acme.com");
        const samId = idOfUser(stack, "sam@acme.com");
        await signUp(stack.auth, "olga@globex.com");
        const olgaId = idOfUser(stack, "olga@globex.com");
        const context = await stack.auth.$context;
        await context.internalAdapter.linkAccount({
          userId: samId,
          providerId: "auth0",
          issuer: oauthIssuer("auth0"),
          accountId: "user-1",
        });
        await context.internalAdapter.linkAccount({
          userId: olgaId,
          providerId: "okta",
          issuer: oauthIssuer("okta"),
          accountId: "user-1",
        });
        stack.db.account = [];

        const fromAuth0 = await context.internalAdapter.findAccountByKey({
          issuer: oauthIssuer("auth0"),
          accountId: "user-1",
        });
        const fromOkta = await context.internalAdapter.findAccountByKey({
          issuer: oauthIssuer("okta"),
          accountId: "user-1",
        });

        expect(fromAuth0?.userId).toBe(samId);
        expect(fromOkta?.userId).toBe(olgaId);
      });
    });
  });
});

/**
 * A second verified address the user holds, with no protocol row behind it —
 * exactly what `Identifier` models and `user.email` cannot. It is what
 * "sign in by any verified email" resolves through.
 */
function attachVerifiedAlias(
  stack: Stack,
  { userId, value }: { userId: string; value: string },
): void {
  stack.heads.fold(userId, [
    {
      type: IDENTIFIER_ATTACHED_EVENT_TYPE,
      data: {
        identifierId: `idf_${value}`,
        userId,
        accountId: null,
        provider: "email",
        providerId: null,
        issuer: null,
        providerAccountId: null,
        value,
        identifierHash: null,
        domain: value.slice(value.indexOf("@") + 1),
        connectionId: null,
        state: "VERIFIED",
        actor: { type: "user", id: userId },
      },
    },
  ]);
}
