import { defineConfig } from "vitest/config";

// Integration lane: *.integration.test.ts; needs Redis for mapping-throttle
// Lua staging; glob pattern prevents path rot vs literal paths.
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    fileParallelism: false,
    pool: "forks",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@langwatch/coding-agent-contract/testing": new URL(
        "../contract/src/testing.ts",
        import.meta.url,
      ).pathname,
      "@langwatch/coding-agent-contract": new URL("../contract/src/index.ts", import.meta.url)
        .pathname,
      "@langwatch/github-contract": new URL("../../github/contract/src/index.ts", import.meta.url)
        .pathname,
      "@langwatch/project-contract": new URL("../../project/contract/src/index.ts", import.meta.url)
        .pathname,
      zod: new URL(
        "../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.js",
        import.meta.url,
      ).pathname,
    },
  },
});
