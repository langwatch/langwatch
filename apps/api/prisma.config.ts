import { defineConfig } from "prisma/config";

/**
 * The Prisma CLI configuration for `prisma generate`, run from this
 * directory by `apps/server`'s prepare step (`node-deps.ts`).
 *
 * `@langwatch/prisma-client` owns the canonical schema and migration
 * history; this file is only the CLI configuration a command run FROM here
 * needs. The migration itself moved: the API image's boot chain now runs
 * `apps/tasks`' `prisma-migrate`, `clickhouse-migrate`, then
 * `lwql-provision` tasks, in that order, against
 * `packages/prisma-client/prisma.config.ts` — not this file — before the API
 * serves.
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
