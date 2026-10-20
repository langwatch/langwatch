import { defineConfig } from "prisma/config";

// Generation needs no database. An operator's `prisma migrate resolve` here, as a failed
// upgrade names it, needs DATABASE_URL: attached only when set, as apps/tasks/prisma.config.ts.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // The local-dev / CI fixture: the tasks runner's storage-seed task, which
    // loads the repository-root .env itself.
    seed: "pnpm --filter @langwatch/tasks task storage-seed",
  },
  ...(process.env.DATABASE_URL ? { datasource: { url: process.env.DATABASE_URL } } : {}),
});
