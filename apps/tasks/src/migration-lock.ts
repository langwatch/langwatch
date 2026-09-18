import { createLogger } from "@langwatch/observability";

export function migrationLockKey(): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from("langwatch:migrations", "utf8")) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return BigInt.asIntN(64, hash).toString();
}

/** Runs `run` under the advisory lock, on a connection from the given pool. */
export async function holdMigrationLock(
  pool: { connect(): Promise<PoolClient> },
  run: () => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  let held = false;
  try {
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS locked",
      [migrationLockKey()],
    );
    held = result.rows[0]?.locked === true;
    if (!held) {
      createLogger("langwatch:tasks").info("waiting for migration lock held by another runner");
      await client.query("SELECT pg_advisory_lock($1::bigint)", [migrationLockKey()]);
      held = true;
    }
    await run();
  } finally {
    try {
      if (held) {
        await client.query("SELECT pg_advisory_unlock($1::bigint)", [migrationLockKey()]);
      }
    } finally {
      client.release();
    }
  }
}

/** Just the part of a pg pool client this lock uses. */
type PoolClient = {
  query<Row>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>;
  release(): void;
};
