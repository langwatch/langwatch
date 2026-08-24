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

const userIdOf = (stack: Stack): string => stack.db.user?.[0]?.id as string;

const statedIdentifiers = (stack: Stack) =>
  [...stack.heads.heads.values()].flatMap((heads) =>
    Object.values(heads.identifiers),
  );

const accountRow = (stack: Stack, id: string) =>
  stack.db.account?.find((row) => row.id === id);

/** The `Account` row the fold maintains during the bridge phase. The memory
 *  engine has no fold behind it, so a suite that wants to watch the mirror
 *  puts the row there itself. */
function seedBridgeRow(stack: Stack, accountId: string): void {
  stack.db.account?.push({
    id: accountId,
    userId: userIdOf(stack),
    providerId: "credential",
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
        await signUp(stack.auth, "sam.j+news@acme.com");
        expect(statedIdentifiers(stack)[0]?.value).toBe("sam.j@acme.com");
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
          accountId: "g-123",
        });
        stack.db.account = [];

        const resolved = await context.internalAdapter.findOAuthUser(
          EMAIL,
          "g-123",
          "google",
        );

        expect(resolved?.user.id).toBe(userId);
        expect(resolved?.linkedAccount?.providerId).toBe("google");

        // A held user — the projection holds them, the gate does not open —
        // falls through to the legacy branch, which is still their truth.
        stack.gate.open = () => false;
        expect(
          await context.internalAdapter.findAccountByProviderId(
            "g-123",
            "google",
          ),
        ).toBeNull();
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
          accountId: "sub-google-1",
        });

        const listed = await context.internalAdapter.findAccounts(userId);
        const pinned = statedIdentifiers(stack).map(
          (identifier) => identifier.accountId,
        );
        expect(listed.map((row) => row.id).sort()).toEqual(pinned.sort());

        const google = listed.find((row) => row.providerId === "google");
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
        const remaining = await context.internalAdapter.findAccounts(userId);
        expect(remaining.map((row) => row.providerId)).toEqual(["credential"]);
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

        await expect(refused).rejects.toMatchObject({
          code: "identity_unsupported_storage_query",
          fault: "platform",
        });
        await expect(refused).rejects.toBeInstanceOf(
          IdentityUnsupportedStorageQueryError,
        );
        // The model and the operator name the failure in the log, through
        // `reasons`, and never in the customer-facing message.
        await expect(refused).rejects.toMatchObject({
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

  describe("given one finalized user and one who is not", () => {
    let stack: Stack;

    beforeEach(() => {
      stack = identityStack();
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
