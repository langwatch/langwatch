import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    watch: false,
    // Nothing here reaches a datastore: the tests drive the shutdown ordering
    // and the embedded host with doubles, so this package boots none.
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
