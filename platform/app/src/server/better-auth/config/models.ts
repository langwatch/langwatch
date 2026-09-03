import type { BetterAuthOptions } from "better-auth";

/**
 * The four models better-auth reads and writes, pointed at the columns we
 * already have.
 *
 * Field mappings translate better-auth's canonical names to the legacy
 * snake_case / NextAuth column names we keep in place — no column renames.
 */
export function models(): Pick<
  BetterAuthOptions,
  "user" | "session" | "account" | "verification"
> {
  return {
    user: {
      modelName: "User",
      additionalFields: {
        pendingSsoSetup: { type: "boolean", defaultValue: false, input: false },
        deactivatedAt: { type: "date", required: false, input: false },
        lastLoginAt: { type: "date", required: false, input: false },
      },
    },
    session: {
      modelName: "Session",
      fields: {
        token: "sessionToken",
        expiresAt: "expires",
      },
      /**
       * D06. Both columns are written by `databaseHooks.session.create.before`
       * and never by a client, which is what `input: false` states.
       *
       * The field this replaces was `impersonating`, declared here as
       * `{ type: "string" }` while Prisma declared the same column `Json?`.
       * They disagreed for as long as both existed and the disagreement is
       * gone with the column: impersonation rides the `{actor, subject}` claims
       * now, which our own code reads and writes through Prisma rather than
       * through better-auth's session shape.
       */
      additionalFields: {
        identifierId: { type: "string", required: false, input: false },
        amr: { type: "string[]", required: false, input: false },
      },
      // Preserve NextAuth's 30-day session TTL. BetterAuth defaults to 7 days,
      // which would force users to re-auth more often than before. Match the
      // old NextAuth `maxAge: 30 * 24 * 60 * 60` value for parity.
      expiresIn: 30 * 24 * 60 * 60,
      // Refresh the session expiry on use but not on every request — the old
      // NextAuth behavior was "rolling, but not thrashing the DB".
      updateAge: 24 * 60 * 60,
      /**
       * REQUIRED when `secondaryStorage` is set. Without this, BetterAuth's
       * `createSession` skips the main adapter (Prisma) and only writes to
       * Redis, and a session that exists only in Redis is a session with no
       * columns of our own on it.
       *
       * RE-JUSTIFIED at D06, because its original reason is gone. It used to
       * be here for the legacy `Session.impersonating` JSON column, which has
       * been dropped; two reasons that outlive it stand in its place, and
       * either alone would be enough:
       *
       *   - a session records WHICH sign-in method minted it and WHAT that
       *     sign-in proved (`Session.identifierId`, `Session.amr`), and an
       *     organization's two-step requirement reads the second when a member
       *     reaches its data. A Redis-only row carries neither, so the
       *     requirement would read nothing for everybody and hold every
       *     federated member at a gate they cannot pass;
       *   - impersonation's `{actor, subject}` claims are columns on the same
       *     row, written by `/api/admin/impersonate` and read on every request.
       *
       * Both are reads and writes we perform through Prisma against a row we
       * need to exist. So this stays true, now for reasons that are ours.
       */
      storeSessionInDatabase: true,
    },
    account: {
      modelName: "Account",
      fields: {
        accountId: "providerAccountId",
        providerId: "provider",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        accessTokenExpiresAt: "expires_at",
        idToken: "id_token",
        scope: "scope",
      },
      /**
       * Allow an OAuth sign-in to link to an existing User row when the email
       * matches AND that User's `emailVerified` is true. Without this, an
       * orphan User (no `Account` rows — e.g. pre-seeded invite, half-finished
       * legacy signup, or migration leftover) blocks every subsequent OAuth
       * sign-in for that email with `account_already_linked_to_different_user`
       * → surfaced to the UI as "registered with another authentication method".
       *
       * On SSO-enforced orgs this was especially broken: even though the user
       * authenticated successfully through the org's IdP, BetterAuth refused to
       * attach the new Account, leaving them permanently locked out.
       *
       * Security posture: linking requires the existing User to be
       * `emailVerified=true` and the OAuth provider to return the same email
       * (`allowDifferentEmails` defaults to false). SSO-domain enforcement
       * still runs in `beforeAccountCreate` and rejects the wrong provider
       * before any link happens.
       */
      accountLinking: {
        enabled: true,
      },
    },
    verification: {
      modelName: "VerificationToken",
      fields: {
        identifier: "identifier",
        value: "token",
        expiresAt: "expires",
      },
    },
  };
}
