import { defineConfig } from "prisma/config";

// Generation needs no database. Migration callers supply a database URL to
// PrismaMigrationService instead of making this package read process.env.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // The local-dev / CI fixture. It reads the repository-root .env itself, so
    // it needs no dotenv preload here.
    seed: "tsx prisma/seed.ts",
  },
});
