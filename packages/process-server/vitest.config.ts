import { defineConfig } from "vitest/config";

/**
 * Node only, and no datastore: this package owns the process lifecycle, so its
 * tests drive signals, phases and timers rather than reaching a client.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
