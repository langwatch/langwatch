import { defineModuleVitestConfig } from "@langwatch/vitest-config";

export default defineModuleVitestConfig({
  kind: "jsdom",
  // Isolated: several door files collapsed onto one module here, and a
  // shared worker leaks one file's vi.mock into its neighbours otherwise.
  isolate: true,
  test: {
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
