import { defineConfig } from "prisma/config";

/**
 * The Prisma CLI configuration `prisma-migrate` runs against.
 *
 * `@langwatch/prisma-client` owns the canonical schema and migration history,
 * and its own `prisma.config.ts` deliberately carries no datasource: generation
 * needs no database, and a config that resolved `DATABASE_URL` eagerly would
 * make `prisma generate` demand one. `prisma migrate deploy`, though, refuses
 * to run without `datasource.url` in the config file — Prisma 7 stopped reading
 * `DATABASE_URL` from the environment for migrate commands — so pointing the
 * task at the package's config failed every time with "The datasource.url
 * property is required in your Prisma config file".
 *
 * This is where the URL belongs: the process supplies it, exactly as
 * `PrismaMigrationService` describes the split. Attached only when it is set,
 * so `--help` and a dry run still work in a shell that has no database.
 */
export default defineConfig({
  schema: "../../packages/prisma-client/prisma/schema.prisma",
  migrations: {
    path: "../../packages/prisma-client/prisma/migrations",
  },
  ...(process.env.DATABASE_URL ? { datasource: { url: process.env.DATABASE_URL } } : {}),
});
