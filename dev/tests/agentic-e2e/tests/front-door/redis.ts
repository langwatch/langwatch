/**
 * Direct Redis access: better-auth's secondary storage (configured here)
 * is where single-use verification values live. Sign-up tokens are NOT
 * here — those are in Postgres, see `db.ts`.
 */
import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6380";
const RESET_KEY_PREFIX = "better-auth:verification:reset-password:";

function redisDbIndex(): number {
  const explicit = process.env.REDIS_DB_INDEX;
  if (explicit !== undefined && explicit !== "") return Number(explicit);
  const port = Number(
    process.env.PORT ||
      new URL(process.env.BASE_URL ?? "http://localhost:5570").port ||
      5570,
  );
  const index = Math.floor((port - 5560) / 10);
  return index < 0 || index > 15 ? 0 : index;
}

let client: Redis | undefined;

function getClient(): Redis {
  client ??= new Redis(REDIS_URL, {
    db: redisDbIndex(),
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });
  return client;
}

async function scanResetKeys(): Promise<string[]> {
  const redis = getClient();
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await redis.scan(
      cursor,
      "MATCH",
      `${RESET_KEY_PREFIX}*`,
      "COUNT",
      200,
    );
    cursor = next;
    keys.push(...batch);
  } while (cursor !== "0");
  return keys;
}

/**
 * The password-reset token most recently issued for `userId` — scoped to
 * the user (not "newest of all") so two tests requesting resets close
 * together can never read each other's link.
 */
export async function findPasswordResetToken(
  userId: string,
): Promise<string | null> {
  const redis = getClient();
  let newest: { token: string; createdAt: number } | null = null;
  for (const key of await scanResetKeys()) {
    const raw = await redis.get(key);
    if (!raw) continue;
    let parsed: { value?: string; createdAt?: string } | null = null;
    try {
      parsed = JSON.parse(raw) as { value?: string; createdAt?: string };
    } catch {
      continue;
    }
    if (parsed?.value !== userId) continue;
    const createdAt = Date.parse(parsed.createdAt ?? "") || 0;
    if (!newest || createdAt > newest.createdAt) {
      newest = { token: key.slice(RESET_KEY_PREFIX.length), createdAt };
    }
  }
  return newest?.token ?? null;
}

/** Closes the connection. Call once, from a suite-level `afterAll`. */
export async function closeRedis(): Promise<void> {
  await client?.quit();
  client = undefined;
}
