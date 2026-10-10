import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    isolate: true,
    setupFiles: ["./src/ui/sections/__tests__/setup.ts"],
  },
});
