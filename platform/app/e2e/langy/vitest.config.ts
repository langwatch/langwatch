import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    // Scenarios are slow (LLM judge + simulator + multi-tool flows), and a
    // single turn may legitimately work for up to TURN_STREAM_TIMEOUT_MS
    // (langy-agent.ts), so a two-turn scenario plus judging needs headroom past
    // two turn budgets AND past a second pass of all of it, because
    // runScenarioAndLog replays the whole scenario once on a transient
    // infrastructure failure. At 600s the replay could not finish, so a
    // recoverable hiccup was reported as a hung test.
    testTimeout: 1_500_000,
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
    // The fake workbench tab (fake-workbench-tab.ts) runs the app's own store,
    // action manifest and UI-action orchestration, so this suite imports from
    // `~/...` the same way the app does. Mirrors platform/app/vitest.config.ts.
    alias: {
      "~/": join(here, "../../src/"),
    },
    // ONE zod instance for the app AND the packages this suite loads
    // (@langwatch/scenario resolves its own copy otherwise): zod v3
    // instanceof-checks its own classes, so a second physical copy silently
    // mis-parses a manifest payload schema.
    dedupe: ["zod"],
  },
});
