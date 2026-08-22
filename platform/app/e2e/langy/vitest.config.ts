import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Scenarios are slow (LLM judge + simulator + multi-tool flows), and a
    // single turn may legitimately work for up to 300s (langy-agent.ts), so a
    // two-turn scenario plus judging needs headroom past two turn budgets.
    testTimeout: 600_000,
    hookTimeout: 30_000,
  },
});
