import { type PrismaDriverAdapter, PrismaDriverAdapterService } from "@langwatch/prisma-client";
import { MigrationLock } from "../migration-lock.port.ts";

/** The one string the lock key is derived from. Changing it splits the mutex. */
export const MIGRATION_LOCK_NAME = "langwatch:migrations";

/**
 * A borrowed pg connection, named without depending on `pg` itself: the pool
 * comes from `@langwatch/prisma-client`, and `connect()` is overloaded, so the
 * type is read off a call rather than off the method.
 */
function borrowClient(pool: PrismaDriverAdapter["pool"]) {
  return pool.connect();
}

type PoolClient = Awaited<ReturnType<typeof borrowClient>>;

/**
 * `pg_advisory_lock` is session-scoped, so the connection that takes it must
 * be the connection that holds it and the one that gives it back. This adapter
 * owns a pool of its own for exactly that reason: a client borrowed from the
 * application's pool would be handed back to somebody else mid-migration, and
 * the lock would travel with it.
 */
export class PostgresMigrationLockAdapter extends MigrationLock {
  private connection: { adapter: PrismaDriverAdapter; client: PoolClient } | undefined;
  private held = false;

  private constructor(private readonly databaseUrl: string) {
    super();
  }

  static create({ databaseUrl }: { databaseUrl: string }): PostgresMigrationLockAdapter {
    return new PostgresMigrationLockAdapter(databaseUrl);
  }

  async tryAcquire(): Promise<boolean> {
    const client = await this.connect();
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1::bigint) AS locked",
      [migrationLockKey()],
    );
    this.held = result.rows[0]?.locked === true;
    return this.held;
  }

  async acquire(): Promise<void> {
    const client = await this.connect();
    await client.query("SELECT pg_advisory_lock($1::bigint)", [migrationLockKey()]);
    this.held = true;
  }

  async release(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    if (!connection) return;
    try {
      if (this.held) {
        await connection.client.query("SELECT pg_advisory_unlock($1::bigint)", [
          migrationLockKey(),
        ]);
      }
    } finally {
      this.held = false;
      connection.client.release();
      await connection.adapter.pool.end();
    }
  }

  private async connect(): Promise<PoolClient> {
    if (this.connection) return this.connection.client;
    const adapter = PrismaDriverAdapterService.create().create(this.databaseUrl);
    const client = await borrowClient(adapter.pool);
    this.connection = { adapter, client };
    return client;
  }
}

/**
 * FNV-1a over {@link MIGRATION_LOCK_NAME}, folded into the signed 64-bit range
 * `pg_advisory_lock` takes. Passed as a decimal string because that is what
 * the driver sends for a bigint parameter.
 */
export function migrationLockKey(): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(MIGRATION_LOCK_NAME, "utf8")) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return BigInt.asIntN(64, hash).toString();
}
