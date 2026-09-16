/**
 * The identity storage adapter with everything unlatched (ADR-116 §1):
 * proves the gate ships CLOSED (diffed stock vs. adapter-wired) and the
 * FACTORY SPINE's bypass paths. The accounts port is INERT. Hermetic.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { AuthUnderTest, IdentityStack, MemoryDB } from "./support/storage-adapter-stack.ts";
import {
  identityStack,
  NEW_PASSWORD,
  PASSWORD,
  signUp,
  stockStack,
} from "./support/storage-adapter-stack.ts";

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
    accountId: account.accountId === userId ? "<the user's own id>" : account.accountId,
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
   * The legacy engine here follows the current Prisma account shape,
   * including better-auth 1.7's issuer column. Pins both halves: synthetic
   * issuers translate when they repeat the provider; real ones persist.
   */
  describe("given the legacy engine is bound to the Prisma account schema", () => {
    let identity: IdentityStack;

    beforeEach(() => {
      identity = identityStack({ inert: true, schemaBoundLegacy: true });
    });

    /** @scenario "Legacy account writes persist synthetic and real issuers" */
    it("persists the issuer chosen for provider and connection accounts", async () => {
      await signUp(identity.auth, EMAIL);
      const context = await identity.auth.$context;
      const userId = identity.db.user?.[0]?.id as string;

      await context.internalAdapter.linkAccount({
        userId,
        providerId: "github",
        issuer: "local:oauth:github",
        accountId: "sub-github-1",
      });
      await context.internalAdapter.linkAccount({
        userId,
        providerId: "connection-acme",
        issuer: "https://login.acme.example",
        accountId: "subject-olga",
      });

      expect(identity.db.account).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            providerId: "github",
            accountId: "sub-github-1",
            issuer: "local:oauth:github",
          }),
          expect.objectContaining({
            providerId: "connection-acme",
            accountId: "subject-olga",
            issuer: "https://login.acme.example",
          }),
        ]),
      );
    });

    /** @scenario "A connection is found by its own issuer, not refused for it" */
    it("finds a connection account by the real issuer it was linked under", async () => {
      // The OAuth callback looks an account up by `(issuer, accountId)`; a
      // connection's issuer is its own URL, not a synthetic one. Answering
      // "no rows" for an issuer it could not decode meant every returning
      // connection sign-in failed to find its row and hit the account
      // uniqueness constraint trying to recreate it.
      const cookie = await signUp(identity.auth, EMAIL);
      const context = await identity.auth.$context;
      const userId = identity.db.user?.[0]?.id as string;

      await context.internalAdapter.linkAccount({
        userId,
        providerId: "connection-acme",
        issuer: "https://login.acme.example",
        accountId: "subject-olga",
      });

      const found = await context.adapter.findOne<{
        userId: string;
        issuer: string;
      }>({
        model: "account",
        where: [
          { field: "issuer", value: "https://login.acme.example" },
          { field: "accountId", value: "subject-olga" },
        ],
      });
      expect(found).toMatchObject({
        userId,
        issuer: "https://login.acme.example",
      });

      // And the row kept the issuer it was linked under, rather than being
      // handed back a synthetic one 1.7's own comparison would reject.
      const listed = await identity.auth.api.listUserAccounts({
        headers: new Headers({ cookie }),
      });
      expect(listed.map((row) => row.providerId).sort()).toEqual(["connection-acme", "credential"]);
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

    /** @scenario "A provider is never matched under another issuer" */
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

    /** @scenario "An issuer-keyed query still finds a row the backfill missed" */
    it("finds a row with no stored issuer by its synthetic issuer, and mints one back", async () => {
      // A row predating (or otherwise missing) the 20260825030000 backfill:
      // `providerId` is the only truth it carries, exactly the shape every
      // row had before that migration ran.
      await signUp(identity.auth, EMAIL);
      const userId = identity.db.user?.[0]?.id as string;
      identity.db.account?.push({
        id: "acc-github-legacy",
        userId,
        providerId: "github",
        accountId: "sub-github-legacy",
        issuer: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const context = await identity.auth.$context;

      // An issuer-alone query — the OAuth callback's own shape — still finds
      // the row: `legacyAccountWhere` rewrites the synthetic issuer back to
      // the providerId clause the row actually carries a value for.
      const found = await context.adapter.findOne<{
        userId: string;
        providerId: string;
        issuer: string | null;
      }>({
        model: "account",
        where: [
          { field: "issuer", value: "local:oauth:github" },
          { field: "accountId", value: "sub-github-legacy" },
        ],
      });

      // And the row is handed back carrying the issuer better-auth 1.7 would
      // have minted itself — `withLegacyIssuer` — not the null the row
      // actually stores, which would fail 1.7's own comparison.
      expect(found).toMatchObject({ userId, providerId: "github", issuer: "local:oauth:github" });
    });
  });
});
