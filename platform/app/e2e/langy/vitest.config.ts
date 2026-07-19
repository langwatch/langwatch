import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 300_000, // scenarios can be slow (LLM judge + simulator + multi-tool flows)
    hookTimeout: 30_000,
  },
});
