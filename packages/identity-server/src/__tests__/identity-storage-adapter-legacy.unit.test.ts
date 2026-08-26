/**
 * The identity storage adapter with everything unlatched (ADR-116 §1).
 *
 * This is the migration-safety claim, checked rather than asserted: the gate
 * ships CLOSED, so deploying the adapter changes nothing on its own. The
 * suite drives the real `betterAuth()` twice over the same flows — once on
 * the completely stock engine, once with the adapter in `database:` — and
 * compares the transcripts.
 *
 * It is also what proves the FACTORY SPINE, which is the whole reason the
 * adapter sits where it does. Two pieces of better-auth's own traffic run
 * below any wrapper and therefore land on us here:
 *
 *  1. `findUserByEmail(email, { includeAccounts: true })` asks for the user
 *     with `join: { account: true }`, and with joins off — the default — the
 *     factory satisfies that join itself through the instance it was built
 *     around. Sign-in passing means the fallback join found our `findMany`.
 *  2. Sign-up runs inside `adapter.transaction`, which for that request is
 *     the ONLY method better-auth calls on the adapter. Sign-up passing
 *     means the factory's as-is passthrough handed better-auth this adapter
 *     rather than something below it.
 *
 * The identity accounts port is INERT: it holds nothing, and every WRITE on
 * it throws, so a closed gate that nevertheless put a row into identity
 * storage fails the suite instead of passing quietly.
 *
 * Hermetic (no database, no network), so it stays in the unit bucket like
 * the ceremonies' own better-auth suite.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type {
  AuthUnderTest,
  IdentityStack,
  MemoryDB,
} from "./support/storage-adapter-stack";
import {
  identityStack,
  NEW_PASSWORD,
  PASSWORD,
  signUp,
  stockStack,
} from "./support/storage-adapter-stack";

const EMAIL = "legacy@acme.com";

interface Stack {
  auth: AuthUnderTest;
  db: MemoryDB;
}

/** What every stack must agree on, with ids and timestamps normalized out. */
interface Transcript {
  signedInEmail: string;
  accountsListed: { providerId: string; accountId: string }[];
  signedInAfterPasswordChange: string;
  providersAfterLink: string[];
  providersAfterUnlink: string[];
  accountRowsAfterUnlink: number;
  usersAfterDelete: number;
  accountRowsAfterDelete: number;
}

/**
 * Sign-up, the joined sign-in read, the account list, a password change, a
 * link, an unlink and a user delete — ADR-116 §7's end-to-end net, run
 * against whichever stack it is handed.
 */
async function walk({ auth, db }: Stack): Promise<Transcript> {
  const cookie = await signUp(auth, EMAIL);
  const headers = new Headers({ cookie });

  const signedIn = await auth.api.signInEmail({
    body: { email: EMAIL, password: PASSWORD },
  });

  const userId = db.user?.[0]?.id as string;
  const listed = await auth.api.listUserAccounts({ headers });
  // better-auth uses the user's own id as a credential account's subject, so
  // the raw value is a fresh id on every run. What has to match across the
  // two stacks is that it still IS the user's id.
  const accountsListed = listed.map((account) => ({
    providerId: account.providerId,
    accountId:
      account.accountId === userId ? "<the user's own id>" : account.accountId,
  }));

  await auth.api.changePassword({
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
    headers,
  });
  const signedInAgain = await auth.api.signInEmail({
    body: { email: EMAIL, password: NEW_PASSWORD },
  });

  const context = await auth.$context;

  await context.internalAdapter.linkAccount({
    userId,
    providerId: "google",
    // better-auth 1.7 keys an account by `(issuer, accountId)`, and
    // synthesises this issuer for a provider that declares none of its own.
    issuer: "local:oauth:google",
    accountId: "sub-google-1",
  });
  const linked = await context.internalAdapter.findAccounts(userId);
  const google = linked.find((row) => row.providerId === "google");

  await context.internalAdapter.deleteAccount(google?.id as string);
  const remaining = await context.internalAdapter.findAccounts(userId);

  const accountRowsAfterUnlink = remaining.length;

  await context.internalAdapter.deleteUser(userId);

  return {
    signedInEmail: signedIn.user.email,
    accountsListed,
    signedInAfterPasswordChange: signedInAgain.user.email,
    providersAfterLink: linked.map((row) => row.providerId).sort(),
    providersAfterUnlink: remaining.map((row) => row.providerId).sort(),
    accountRowsAfterUnlink,
    usersAfterDelete: db.user?.length ?? 0,
    accountRowsAfterDelete: db.account?.length ?? 0,
  };
}

describe("better-auth over the identity storage adapter", () => {
  describe("given every user's gate is closed", () => {
    let identity: IdentityStack;

    beforeEach(() => {
      identity = identityStack({ inert: true });
    });

    /** @scenario "An unlatched user's storage traffic is the stock adapter's, byte for byte" */
    it("walks the whole flow to the same transcript the stock engine produces", async () => {
      const stock = await walk(stockStack());
      const routed = await walk(identity);

      expect(routed).toEqual(stock);
      // Nothing was stated and nothing was written to identity storage: an
      // identity write would have thrown on the inert port, and the ledger
      // is untouched.
      expect(identity.commands).toHaveLength(0);
      expect(identity.heads.heads.size).toBe(0);
      expect(identity.storage.credentials.size).toBe(0);
    });

    it("serves the joined sign-in read that only the factory's base can see", async () => {
      await signUp(identity.auth, EMAIL);

      // `signInEmail` reaches findUserByEmail(email, { includeAccounts: true
      // }), which is the read a wrapper over a finished adapter could not
      // serve: the factory issues the account half itself, through the
      // instance it was built around.
      const signedIn = await identity.auth.api.signInEmail({
        body: { email: EMAIL, password: PASSWORD },
      });

      expect(signedIn.user.email).toBe(EMAIL);
    });

    it("writes sessions through the legacy branch and states nothing", async () => {
      const cookie = await signUp(identity.auth, EMAIL);

      const session = await identity.auth.api.getSession({
        headers: new Headers({ cookie }),
      });

      expect(session?.user.email).toBe(EMAIL);
      expect(identity.db.session).toHaveLength(1);
      expect(identity.commands).toHaveLength(0);
    });

    /** @scenario "A fleet with nobody latched never meets the loud failure" */
    it("runs an account query the branch never enumerated, rather than refusing it", async () => {
      await signUp(identity.auth, EMAIL);
      const context = await identity.auth.$context;

      // The shape names no user, so the per-user gate cannot be asked. On a
      // fleet where nobody has latched there is nobody the branch could be
      // answering for, and §7's loud failure must not catch the whole legacy
      // population — "deploying this changes nothing" is the claim.
      const byShape = await context.adapter.findMany({
        model: "account",
        where: [{ field: "scope", value: "openid" }],
      });
      expect(byShape).toEqual([]);

      const sorted = await context.adapter.findMany({
        model: "account",
        sortBy: { field: "createdAt", direction: "asc" },
      });
      expect(sorted).toHaveLength(1);
    });
  });

  /**
   * The legacy engine here holds the Prisma schema's line: no `issuer`
   * column on `account`, and naming one is refused the way
   * `PrismaClientValidationError` refuses it. The stock memory engine
   * absorbs any field, which is how this regression stayed green here
   * while `/two-factor/enable` threw in production.
   */
  describe("given the legacy engine is bound to the Prisma account schema", () => {
    let identity: IdentityStack;

    beforeEach(() => {
      identity = identityStack({ inert: true, schemaBoundLegacy: true });
    });

    /** @scenario "A legacy account write never carries the issuer column" */
    it("signs up and links a provider without handing the engine an issuer", async () => {
      const cookie = await signUp(identity.auth, EMAIL);
      const context = await identity.auth.$context;
      const userId = identity.db.user?.[0]?.id as string;

      await context.internalAdapter.linkAccount({
        userId,
        providerId: "google",
        issuer: "local:oauth:google",
        accountId: "sub-google-1",
      });

      const listed = await identity.auth.api.listUserAccounts({
        headers: new Headers({ cookie }),
      });
      expect(listed.map((row) => row.providerId).sort()).toEqual([
        "credential",
        "google",
      ]);
    });

    it("finds a built-in provider's account by the real issuer it was linked under", async () => {
      // The case nothing covered, and the reason it mattered: the OAuth
      // callback looks an account up by `(issuer, accountId)`, and Google's
      // issuer is its own URL rather than a synthetic one. While the write
      // stripped the column and the read answered "no rows" for an issuer it
      // could not decode, every returning Google sign-in failed to find its
      // own row — and better-auth created it again, into the unique
      // constraint on (provider, providerAccountId).
      const cookie = await signUp(identity.auth, EMAIL);
      const context = await identity.auth.$context;
      const userId = identity.db.user?.[0]?.id as string;

      await context.internalAdapter.linkAccount({
        userId,
        providerId: "google",
        issuer: "https://accounts.google.com",
        accountId: "sub-google-real",
      });

      const found = await context.adapter.findOne<{ userId: string }>({
        model: "account",
        where: [
          { field: "issuer", value: "https://accounts.google.com" },
          { field: "accountId", value: "sub-google-real" },
        ],
      });
      expect(found?.userId).toBe(userId);

      // And the row kept the issuer it was linked under, rather than being
      // handed back a synthetic one 1.7's own comparison would reject.
      const listed = await identity.auth.api.listUserAccounts({
        headers: new Headers({ cookie }),
      });
      expect(listed.map((row) => row.providerId).sort()).toEqual([
        "credential",
        "google",
      ]);
    });

    /** @scenario "An issuer-keyed account read on the legacy branch drops the synthetic issuer" */
    it("serves the issuer-keyed credential read /two-factor/enable sends", async () => {
      await signUp(identity.auth, EMAIL);
      const context = await identity.auth.$context;
      const userId = identity.db.user?.[0]?.id as string;

      // The exact shape 1.7's enableTwoFactor issues: the user, the
      // provider, the synthetic issuer and the subject, all at once.
      const row = await context.adapter.findOne({
        model: "account",
        where: [
          { field: "userId", value: userId },
          { field: "providerId", value: "credential" },
          { field: "issuer", value: "local:credential" },
          { field: "accountId", value: userId },
        ],
      });

      expect(row).not.toBeNull();
    });

    /** @scenario "A connection is found by its own issuer, not refused for it" */
    it("finds a connection's account the way the callback actually looks for it", async () => {
      await signUp(identity.auth, EMAIL);
      const context = await identity.auth.$context;
      const userId = identity.db.user?.[0]?.id as string;
      // A connection id, in the shape `newSsoConnectionId` mints under a
      // non-production environment prefix, and the issuer it registered.
      const connectionId = "local_ssoc_00006mVlCMfpl4S67cYCs9ZC272Ho";
      const issuer = "https://idp.acme1.test";
      const subject = "t1-user-admin";
      identity.registerConnection({ providerId: connectionId, issuer });

      // The first sign-in, which is the one that always worked.
      await context.internalAdapter.linkAccount({
        userId,
        providerId: connectionId,
        issuer,
        accountId: subject,
      });

      // THE SECOND SIGN-IN, keyed the way better-auth keys it:
      // `findAccountOwnerByKey` sends the issuer and the subject and NO
      // provider id at all. Answering null here is what sent the callback
      // into a duplicate insert and a unique-constraint failure.
      const owner = await context.internalAdapter.findAccountOwnerByKey({
        issuer,
        accountId: subject,
      });

      expect(owner).not.toBeNull();
      // And the row comes back wearing the issuer the ceremony is running
      // for. A synthetic one fails 1.7's own `acc.issuer === account.issuer`
      // comparison, so finding the row would not have been enough by itself.
      expect(owner?.account.issuer).toBe(issuer);
    });

    /** @scenario "An issuer the legacy table cannot answer returns no rows instead of throwing" */
    it("answers no rows for an issuer that contradicts the provider beside it", async () => {
      await signUp(identity.auth, EMAIL);
      const context = await identity.auth.$context;
      const userId = identity.db.user?.[0]?.id as string;

      const contradicted = await context.adapter.findOne({
        model: "account",
        where: [
          { field: "userId", value: userId },
          { field: "providerId", value: "credential" },
          { field: "issuer", value: "https://accounts.google.com" },
        ],
      });
      expect(contradicted).toBeNull();

      // A real issuer standing alone IS answerable now — it matches the
      // column — and the answer here is still empty, because the only row
      // seeded carries the synthetic credential issuer. That is narrowing,
      // not widening: nothing resolves one identity provider's subject onto
      // another's.
      const unanswerable = await context.adapter.findMany({
        model: "account",
        where: [{ field: "issuer", value: "https://accounts.google.com" }],
      });
      expect(unanswerable).toEqual([]);

      // While the synthetic form alone is decodable, and answers.
      const decoded = await context.adapter.findMany({
        model: "account",
        where: [
          { field: "userId", value: userId },
          { field: "issuer", value: "local:credential" },
        ],
      });
      expect(decoded).toHaveLength(1);
    });
  });
});
