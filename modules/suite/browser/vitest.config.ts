import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fsModuleCache: true,
    isolate: true,
    setupFiles: ["./src/ui/sections/__tests__/setup.ts"],
  },
});
