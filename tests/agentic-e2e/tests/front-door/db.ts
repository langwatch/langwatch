/**
 * Direct Postgres access for the front-door e2e suite.
 *
 * CONFIRMATION AND RESET LINKS ARE EMAILED, AND CI HAS NO MAIL PROVIDER
 * (`e2e-ci.yml` sets no SendGrid/SES key, so `HAS_EMAIL_PROVIDER_KEY` is
 * false and `/auth/forgot-password` renders the "cannot send email" card
 * instead of its form). The app's own request endpoints
 * (`/api/auth/request-password-reset`, sign-up's `requestSignUpVerification`)
 * still write their single-use token row before they ever try to send mail —
 * `sendResetPassword` runs through `runInBackgroundOrAwait` and sign-up's
 * `SignUpVerificationService.issueLink` writes the row before calling the
 * mailer at all — so calling those endpoints directly and then reading the
 * token straight out of Postgres reproduces exactly what a person would do by
 * clicking the email, without needing an inbox in CI.
 *
 * Both kinds of token live in the SAME table, `VerificationToken`
 * (better-auth's own `verification` model is mapped onto it, see
 * `platform/app/src/server/better-auth/config/models.ts`), distinguished by a
 * namespace prefix on the `identifier` column:
 *
 *   - sign-up confirmation: `identifier` is
 *     `identity-signup-verification:{"email":"...","passwordHash":...}` and
 *     the raw, URL-ready token lives in the `token` column
 *     (`signup-verification.service.ts` `SIGN_UP_TOKEN_NAMESPACE`).
 *   - password reset: `identifier` is `reset-password:<token>` — the token is
 *     embedded in the IDENTIFIER, and the `token` column instead holds the
 *     user id (better-auth's own `dist/api/routes/password.mjs`
 *     `requestPasswordReset` handler). This is the opposite shape from
 *     sign-up's own token store, so the two need separate queries.
 *
 * The `pg` dependency this file needs is the one deliberate exception to this
 * package's "nothing but @playwright/test" rule (see `license.fixture.ts`) —
 * required to read a token CI has no other way to hand a test.
 */
import { Pool } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://prisma:prisma@localhost:5433/testdb?schema=testdb";

/**
 * The `pg` driver ignores the Prisma-style `?schema=` query parameter (see
 * `platform/app/src/server/prismaPgAdapter.ts`, which parses it out and hands
 * it to the adapter explicitly). Read it out here the same way, and set it as
 * the connection's search_path, so `SELECT ... FROM "VerificationToken"`
 * resolves against the schema the app itself writes into rather than
 * `public`.
 */
function schemaFrom(databaseUrl: string): string | undefined {
  try {
    return new URL(databaseUrl).searchParams.get("schema") ?? undefined;
  } catch {
    return undefined;
  }
}

const schema = schemaFrom(DATABASE_URL);

let pool: Pool | undefined;

function getPool(): Pool {
  pool ??= new Pool({
    connectionString: DATABASE_URL,
    ...(schema ? { options: `-c search_path="${schema}"` } : {}),
    max: 2,
  });
  return pool;
}

/**
 * The sign-up confirmation token most recently issued for `email`, if any.
 *
 * Matches on the JSON-encoded `identifier`'s `email` field rather than
 * parsing every row in JS: the namespace prefix plus a literal
 * `"email":"<value>"` substring is exactly the shape
 * `signup-verification.service.ts` writes, and it is far cheaper to let
 * Postgres filter than to pull every pending sign-up token back into the
 * test.
 *
 * Query BEFORE visiting the link: claiming a token renames its `identifier`
 * into the `identity-signup-spent:` namespace (still queryable, but no longer
 * matched by this function on purpose — a spent token is not "most recent
 * live one for this email").
 */
export async function findSignUpVerificationToken(
  email: string,
): Promise<string | null> {
  const result = await getPool().query<{ token: string }>(
    `SELECT token FROM "VerificationToken"
     WHERE identifier LIKE 'identity-signup-verification:%'
       AND identifier LIKE $1
     ORDER BY "createdAt" DESC
     LIMIT 1`,
    [`%"email":"${email}"%`],
  );
  return result.rows[0]?.token ?? null;
}

/**
 * The password-reset token most recently issued, full stop — not scoped to
 * an email, because better-auth's own reset rows carry the user id in the
 * `token` column and the email nowhere at all. Safe because every front-door
 * test that calls this uses a freshly generated, unique address for the one
 * request it makes right before reading this back.
 */
export async function findPasswordResetToken(): Promise<string | null> {
  const result = await getPool().query<{ identifier: string }>(
    `SELECT identifier FROM "VerificationToken"
     WHERE identifier LIKE 'reset-password:%'
     ORDER BY "createdAt" DESC
     LIMIT 1`,
  );
  const identifier = result.rows[0]?.identifier ?? null;
  return identifier ? identifier.slice("reset-password:".length) : null;
}

/** Closes the pool. Call once, from a suite-level `afterAll`. */
export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
