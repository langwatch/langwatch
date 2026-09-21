// Prisma 7 CLI configuration. The CLI no longer auto-loads .env, so dotenv
// runs first; the runtime client gets its connection from the pg driver
// adapter in src/server/db.ts, not from here.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // `env("DATABASE_URL")` resolves eagerly at config load, which would make
  // even `prisma generate` demand a database URL. Only the migrate/db
  // commands need a datasource, so it is attached only when the URL exists.
  ...(process.env.DATABASE_URL
    ? { datasource: { url: process.env.DATABASE_URL } }
    : {}),
});
