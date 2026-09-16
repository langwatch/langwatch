/**
 * Direct Postgres access for the front-door e2e suite: CI has no mail
 * provider, so the sign-up token is read from `VerificationToken` instead
 * of an inbox. Password-reset tokens are NOT here — see `redis.ts`.
 */
import { Pool } from "pg";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://prisma:prisma@localhost:5433/testdb?schema=testdb";

/**
 * `pg` ignores the Prisma-style `?schema=` param (see
 * prismaPgAdapter.ts). Read it out and set it as search_path, so queries
 * resolve against the schema the app writes into, not `public`.
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
 * The sign-up token most recently issued for `email`, matched via a LIKE
 * substring on the JSON-encoded `identifier` rather than pulling every row
 * into JS. Call BEFORE visiting the link — claiming renames the identifier.
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
