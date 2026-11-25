import { defineConfig } from "prisma/config";

// Prisma CLI config for `prisma generate`. The canonical schema is in
// packages/prisma-client; this attaches DATABASE_URL only when set so that
// `prisma generate` can run without a database in the shell.
export default defineConfig({
  schema: "../../packages/prisma-client/prisma/schema.prisma",
  migrations: {
    path: "../../packages/prisma-client/prisma/migrations",
  },
  ...(process.env.DATABASE_URL ? { datasource: { url: process.env.DATABASE_URL } } : {}),
});
