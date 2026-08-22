import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Scenarios are slow (LLM judge + simulator + multi-tool flows), and a
    // single turn may legitimately work for up to 300s (langy-agent.ts), so a
    // two-turn scenario plus judging needs headroom past two turn budgets.
    testTimeout: 600_000,
    // The dogfood beforeAll runs both seeders: seedNavigablePrompt allows three
    // attempts at 20s each and seedFailingApplicationTraces polls to a 45s
    // deadline, so a 30s hook budget aborts every scenario in that file before
    // a single turn runs.
    hookTimeout: 180_000,
    // resetEvaluationResources deletes every monitor and non-seeded evaluator
    // in the project, so two scenario files running at once delete each
    // other's resources. The suite runs one file at a time.
    fileParallelism: false,
  },
});
