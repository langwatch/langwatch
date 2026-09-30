import { defineConfig } from "vitest/config";

// Component tests opt into jsdom with a docblock; nothing sets a global environment.
export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    watch: false,
    testTimeout: 10_000,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
