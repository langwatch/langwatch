import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    watch: false,
    include: ["src/**/*.unit.test.{ts,tsx}"],
  },
});
