import { PrismaPg } from "@prisma/adapter-pg";
import { Pool, type PoolConfig } from "pg";

export interface PrismaPgPoolConfig extends PoolConfig {
  connectionString: string;
  schema: string | undefined;
}

export interface PrismaDriverAdapter {
  adapter: PrismaPg;
  pool: Pool;
}

export abstract class PrismaDriverAdapterFactory {
  abstract create(databaseUrl: string): PrismaDriverAdapter;
}

/**
 * The classic Rust engine read the search-path schema from the connection
 * URL's `?schema=` parameter. The pg driver ignores unknown URL params, so a
 * deployment whose DATABASE_URL carries `?schema=` (dev and prod both do)
 * would silently query `public` while `prisma migrate` kept writing to the
 * named schema. Parse it out and hand it to the adapter explicitly.
 *
 * The engine's pool-tuning URL params need the same treatment: node-postgres
 * ignores `connection_limit` and `pool_timeout`, and its defaults differ from
 * the engine's (max 10 connections vs `cpus * 2 + 1`, wait-forever vs a 10s
 * acquisition timeout). A deployment that tuned its pool through the URL must
 * keep getting what the URL says, so both map onto the pg Pool config.
 */
export class PrismaDriverAdapterService extends PrismaDriverAdapterFactory {
  private constructor() {
    super();
  }

  static create(): PrismaDriverAdapterService {
    return new PrismaDriverAdapterService();
  }

  /**
   * Creates an explicitly owned pg pool and adapter. The adapter does not
   * dispose the external pool: PrismaShutdownService closes both resources in
   * a deterministic order.
   */
  create(databaseUrl: string): PrismaDriverAdapter {
    const { schema, ...poolConfig } = this.poolConfig(databaseUrl);
    const pool = new Pool(poolConfig);
    const adapter = new PrismaPg(pool, {
      schema,
      disposeExternalPool: false,
    });
    return { adapter, pool };
  }

  /**
   * Compatibility construction for a caller that only owns a PrismaClient.
   * PrismaPg owns the pool it creates and closes it when the client disconnects.
   */
  createOwnedAdapter(databaseUrl: string): PrismaPg {
    const { schema, ...poolConfig } = this.poolConfig(databaseUrl);
    return new PrismaPg(poolConfig, { schema });
  }

  poolConfig(databaseUrl: string): PrismaPgPoolConfig {
    const params = urlParams(databaseUrl);
    const schema = params.get("schema") ?? undefined;
    const connectionLimit = positiveIntParam(params, "connection_limit");
    const poolTimeoutSeconds = positiveIntParam(params, "pool_timeout");
    return {
      connectionString: databaseUrl,
      schema,
      // `options` reaches Postgres as startup parameters: raw SQL
      // (`$queryRaw` / `$executeRaw`) is passed through unqualified, so the
      // session search_path must name the schema the same way the engine used
      // to set it. The `schema` adapter option only qualifies model queries.
      ...(schema ? { options: `-c search_path="${schema}"` } : {}),
      ...(connectionLimit !== undefined ? { max: connectionLimit } : {}),
      // pg's `connectionTimeoutMillis` bounds the whole `pool.connect()` wait —
      // queueing for a free slot included — which is what the engine's
      // `pool_timeout` (seconds) bounded.
      ...(poolTimeoutSeconds !== undefined
        ? { connectionTimeoutMillis: poolTimeoutSeconds * 1000 }
        : {}),
    };
  }
}

/**
 * The pg Pool configuration a Prisma-style DATABASE_URL asks for. An empty or
 * malformed URL must not throw HERE: the plain connectionString pass-through
 * never parsed it, so construction stayed lazy and unit suites that import
 * the client without a database (env validation skipped) only fail if they
 * actually connect. Parsing failure = no overrides.
 */
function urlParams(databaseUrl: string): URLSearchParams {
  try {
    return new URL(databaseUrl).searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function positiveIntParam(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}
