import { PrismaPg } from "@prisma/adapter-pg";

/**
 * The classic Rust engine read the search-path schema from the connection
 * URL's `?schema=` parameter. The pg driver ignores unknown URL params, so a
 * deployment whose DATABASE_URL carries `?schema=` (dev and prod both do)
 * would silently query `public` while `prisma migrate` kept writing to the
 * named schema. Parse it out and hand it to the adapter explicitly.
 */
export function createPrismaPgAdapter(databaseUrl: string): PrismaPg {
  const schema = schemaParam(databaseUrl);
  return new PrismaPg(
    {
      connectionString: databaseUrl,
      // `options` reaches Postgres as startup parameters: raw SQL
      // (`$queryRaw` / `$executeRaw`) is passed through unqualified, so the
      // session search_path must name the schema the same way the engine
      // used to set it. The `schema` adapter option below only qualifies
      // model queries.
      ...(schema ? { options: `-c search_path="${schema}"` } : {}),
    },
    { schema },
  );
}

/**
 * An empty or malformed URL must not throw HERE: the plain connectionString
 * pass-through never parsed it, so construction stayed lazy and unit suites
 * that import the client without a database (env validation skipped) only
 * fail if they actually connect. Parsing failure = no schema override.
 */
function schemaParam(databaseUrl: string): string | undefined {
  try {
    return new URL(databaseUrl).searchParams.get("schema") ?? undefined;
  } catch {
    return undefined;
  }
}
