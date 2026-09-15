/**
 * Direct Postgres access for the front-door e2e suite.
 *
 * CONFIRMATION AND RESET LINKS ARE EMAILED, AND CI HAS NO MAIL PROVIDER
 * (`e2e-ci.yml` sets no SendGrid/SES key, so `HAS_EMAIL_PROVIDER_KEY` is
 * false and `/auth/forgot-password` renders the "cannot send email" card
 * instead of its form). Sign-up's own `requestSignUpVerification` still
 * writes its single-use token row before it ever tries to send mail
 * (`SignUpVerificationService.issueLink` writes the row, then calls the
 * mailer), so reading the token straight out of Postgres reproduces exactly
 * what a person would do by clicking the email, without needing an inbox.
 *
 * The sign-up token lives in `VerificationToken`, under the identifier
 * `identity-signup-verification:{"email":"...","passwordHash":...}` with the
 * raw, URL-ready token in the `token` column (`signup-verification.service.ts`
 * `SIGN_UP_TOKEN_NAMESPACE`). Password-reset tokens are better-auth's own and
 * do NOT land here: with secondary storage configured better-auth keeps them
 * in Redis — see `redis.ts`.
 *
 * The `pg` dependency this file needs is one of the two deliberate exceptions
 * (with `ioredis`, for the same reason) to this package's "nothing but
 * @playwright/test" rule (see `license.fixture.ts`) — required to read a token
 * CI has no other way to hand a test.
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
 * The id of the account registered under `email`, if any — what better-auth's
 * reset token is keyed by (`redis.ts`), and the one thing `user.register`
 * does not hand back.
 */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  const result = await getPool().query<{ id: string }>(
    `SELECT id FROM "User" WHERE email = $1 LIMIT 1`,
    [email],
  );
  return result.rows[0]?.id ?? null;
}

/** Closes the pool. Call once, from a suite-level `afterAll`. */
export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
