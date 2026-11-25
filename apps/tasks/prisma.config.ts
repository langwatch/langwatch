import { defineConfig } from "prisma/config";

// Prisma's CLI sends a version check to checkpoint.prisma.io on every command.
// LangWatch never uses it; this file loads before the check runs.
process.env.CHECKPOINT_DISABLE = "1";

// Prisma migrate config. URL attached only when set for migration.
export default defineConfig({
  schema: "../../packages/prisma-client/prisma/schema.prisma",
  migrations: {
    path: "../../packages/prisma-client/prisma/migrations",
  },
  ...(process.env.DATABASE_URL ? { datasource: { url: process.env.DATABASE_URL } } : {}),
});
