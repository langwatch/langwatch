import { defineConfig } from "prisma/config";

// Generation needs no database. Migration callers supply a database URL to
// PrismaMigrationService instead of making this package read process.env.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // The local-dev / CI fixture: the tasks runner's storage-seed task, which
    // loads the repository-root .env itself.
    seed: "pnpm --filter @langwatch/tasks task storage-seed",
  },
});
