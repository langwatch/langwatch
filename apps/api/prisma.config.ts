import { defineConfig } from "prisma/config";

/**
 * The deployment's Postgres migration runner.
 *
 * `@langwatch/prisma-client` owns the canonical schema and migration history;
 * this file is only the CLI configuration for the process that APPLIES them,
 * which is this one. The API image's boot chain runs `task:prisma-migrate`,
 * then `task:clickhouse-migrate`, then `task:lwql-provision`, in that order,
 * before it serves — so both schema owners are applied from the same directory
 * and a failed migration stops the boot rather than serving against a schema
 * that was never applied.
 *
 * The package's own `prisma.config.ts` deliberately carries no datasource:
 * generation needs no database, and a config that resolved `DATABASE_URL`
 * eagerly would make `prisma generate` demand one. The URL is attached here,
 * where a database is exactly what the command needs, and only when it is set —
 * so `--help` and a dry run still work in a shell that has none.
 */
export default defineConfig({
  schema: "../../packages/prisma-client/prisma/schema.prisma",
  migrations: {
    path: "../../packages/prisma-client/prisma/migrations",
  },
  ...(process.env.DATABASE_URL ? { datasource: { url: process.env.DATABASE_URL } } : {}),
});
