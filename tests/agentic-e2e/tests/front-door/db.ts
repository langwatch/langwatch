/**
 * Direct Postgres access for the front-door e2e suite.
 *
 * CI HAS NO MAIL PROVIDER (`e2e-ci.yml` sets none), so `/auth/forgot-password`
 * renders the "cannot send email" card and sign-up answers with an
 * unconfirmed address proof instead of mailing a link. The token read below
 * applies only to an installation that sends email; `confirmAddressOf` stands
 * in for the link where a test needs a confirmed address.
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

/**
 * Marks the address of the account under `email` confirmed, which is what
 * opening its confirmation link would do on an installation that sends email.
 */
export async function confirmAddressOf(email: string): Promise<void> {
  await getPool().query(
    `UPDATE "User" SET "emailVerified" = true WHERE email = $1`,
    [email],
  );
}

/** Whether the account under `email` has a confirmed address. */
export async function isAddressConfirmed(email: string): Promise<boolean> {
  const result = await getPool().query<{ emailVerified: boolean }>(
    `SELECT "emailVerified" FROM "User" WHERE email = $1 LIMIT 1`,
    [email],
  );
  return result.rows[0]?.emailVerified === true;
}

/** Closes the pool. Call once, from a suite-level `afterAll`. */
export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
