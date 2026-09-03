import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Scenarios are slow (LLM judge + simulator + multi-tool flows), and a
    // single turn may legitimately work for up to TURN_STREAM_TIMEOUT_MS
    // (langy-agent.ts), which is 420s. runScenarioAndLog replays the whole
    // scenario once on a transient infrastructure failure, so a two-turn
    // scenario needs four turn windows: 4 x 420s = 1_680_000 ms, rounded up.
    // At 600s the replay could not finish, so a recoverable hiccup was
    // reported as a hung test. A scenario of more than two turns is not
    // covered by this and states its own timeout.
    testTimeout: 1_800_000,
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
  resolve: {
    // ONE zod instance across the packages this suite loads
    // (@langwatch/scenario resolves its own copy otherwise): zod
    // instanceof-checks its own classes, so a second physical copy silently
    // mis-parses a manifest payload schema.
    dedupe: ["zod"],
  },
});
