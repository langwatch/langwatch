import { defineConfig } from "vitest/config";

// Standalone like acme-support: this agent installs the SDK the way a customer's project does.
export default defineConfig({
  test: {
    environment: "node",
    watch: false,
    include: ["src/**/*.test.ts"],
  },
});
