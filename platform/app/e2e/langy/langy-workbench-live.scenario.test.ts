/**
 * The improvement loop with the workbench OPEN in front of the user.
 *
 * Every other prompt-optimization suite runs with no page attached, so every
 * workbench action takes the backend fallback by construction. This one
 * attaches a fake workbench tab (`fake-workbench-tab.ts`) to the same turn
 * stream the adapter already reads, so the actions Langy dispatches are claimed
 * and carried out by a page, through the app's own store and transforms.
 *
 * The tab is closed halfway through the conversation, which is what makes this
 * one run cover both legs: the user steps away, the same verbs continue on the
 * backend, and the workbench still has to reach the state the shared assertion
 * describes.
 *
 * RUN (one file per vitest run, see README):
 *   cd platform/app/e2e/langy && npx vitest run langy-workbench-live.scenario.test.ts --reporter=verbose
 */

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { describe, expect, it } from "vitest";
import { addEvaluatorPayloadSchema } from "~/experiments-v3/actions/schemas";
import { COMPARISON_COLUMN_REFUSAL } from "~/experiments-v3/types";
import {
  type FakeWorkbenchTab,
  openFakeWorkbenchTab,
} from "./fake-workbench-tab";
import { makeLangyAdapter } from "./langy-agent";
import {
  LANGY_LIVE_PAGE_CRITERIA,
  LANGY_OPTIMIZE_LOOP_CRITERIA,
} from "./langy-rules";
import { runScenarioAndLog } from "./scenario-logger";
import {
  getWorkbenchState,
  seedOptimizationWorkbench,
} from "./seed-optimization-workbench";
import {
  expectOptimizedWorkbench,
  expectRunHasRealScores,
  newestRunId,
  readBaselineTarget,
} from "./workbench-assertions";
import { request } from "./workbench-rest";

const model = openai("gpt-5-mini");

/**
 * Three agent turns, each of which may run the dataset, need the headroom;
 * and so does the replay `runScenarioAndLog` grants a transient infrastructure
 * failure, which repeats all three.
 */
const LIVE_LOOP_TIMEOUT_MS = 1_800_000;

/** The marker the CLI prints back for an action a page carried out. */
const BROWSER_MARKER = '"executedVia":"browser"';
const BACKEND_MARKER = '"executedVia":"backend"';

/** Tool outputs that reported which leg carried the action. */
const dispatchOutcomes = (outputs: readonly string[]): string[] =>
  outputs.filter((output) => output.includes('"executedVia"'));

describe("Langy on a workbench the user is watching", () => {
  describe("when the user asks for better answers with the page open", () => {
    /** @scenario A live conversation's actions are claimed and carried out by the open page */
    /** @scenario The loop runs in the page the user has open */
    /** @scenario The user closes the page mid-loop and the loop carries on */
    /** @scenario Langy never says the page shows something it does not */
    it(
      "drives the open page, then carries on once the user steps away",
      async () => {
        const seeded = await seedOptimizationWorkbench({
          name: "support-quality-live",
          rows: 12,
          goldenStyle: "free-text",
          withEvaluator: false,
        });
        const baselineBefore = await readBaselineTarget({
          slug: seeded.experimentSlug,
          baselineTargetId: seeded.baselineTargetId,
        });

        // A real composer attaches the page the user is looking at, and that
        // chip is what tells the turn this surface accepts live UI actions.
        const langy = makeLangyAdapter({
          pageContext: [
            {
              kind: "experiment",
              ref: seeded.experimentSlug,
              label: "support-quality-live",
            },
          ],
        });

        let tab: FakeWorkbenchTab = await openFakeWorkbenchTab({
          adapter: langy,
          experimentSlug: seeded.experimentSlug,
        });
        // Where the conversation splits into its two halves: everything the
        // agent dispatched up to here could reach a page, everything after it
        // could not. `tab.claimedActions` needs no such mark, because the tab
        // is detached from the moment it closes.
        const handover = { dispatches: 0 };

        try {
          const result = await runScenarioAndLog({
            config: {
              name: "the loop runs in the page the user is watching",
              description: `A non-technical webshop founder has the workbench open while Langy works. The experiment has a dataset and a prompt column but no evaluator, so Langy has to attach and map one before it duplicates anything. Halfway through, the user walks away and the page closes; Langy carries on. The experiment's slug is "${seeded.experimentSlug}".`,
              agents: [
                langy,
                scenario.userSimulatorAgent({ model }),
                scenario.judgeAgent({
                  model,
                  criteria: [
                    ...LANGY_OPTIMIZE_LOOP_CRITERIA,
                    ...LANGY_LIVE_PAGE_CRITERIA,
                  ],
                }),
              ],
              script: [
                scenario.user(
                  `my support bot answers policy questions wrong. my experiment is "${seeded.experimentSlug}" and I have it open in front of me. score it and make it better`,
                ),
                scenario.agent(),
                scenario.user(
                  "looks right, go ahead. no need to ask me for small runs",
                ),
                scenario.agent(),
                // The user walks away: the page goes, the conversation does not.
                async () => {
                  handover.dispatches = langy.state.toolOutputs.length;
                  await tab.close();
                },
                // Work the closed page cannot possibly have done already. The
                // agent now finishes the whole loop inside its first turn, so a
                // bare "keep going" is answered with a summary and nothing is
                // dispatched: the handover the test exists to cover is never
                // reached. Naming one more variant keeps the loop running past
                // the close without changing what the loop is.
                scenario.user(
                  "I'm stepping away. keep going: try one more variant and tell me how it lands",
                ),
                scenario.agent(),
                scenario.judge(),
              ],
            },
            // The whole scenario replays once on a transient infrastructure
            // failure, and the first attempt has already closed the tab. A
            // replay with no page would grade the browser leg against a suite
            // that never had one, so the tab is rebuilt before it starts.
            beforeRetry: async () => {
              await tab.close();
              tab = await openFakeWorkbenchTab({
                adapter: langy,
                experimentSlug: seeded.experimentSlug,
              });
            },
          });
          if (!result.success)
            console.log("JUDGE REASONING:", result.reasoning);

          // The facts come before the verdict on purpose. Asserting the judge
          // first means one criterion the model missed hides every Layer-2
          // check behind it, and those are what say whether the browser leg,
          // the handover and the run pipeline actually worked. The reasoning is
          // already printed above either way.

          // Layer 2, the harness's own record: the page really carried actions
          // while it was open. "At least one" rather than "every one": the claim
          // window is a hard 3 second constant server-side, and a lost claim
          // degrades to a backend execution that still writes the right
          // document.
          const executed = tab.claimedActions.filter(
            (action) => action.outcome === "executed",
          );
          expect(
            executed.length,
            `the open page claimed nothing. Seen: ${JSON.stringify(
              tab.seenActions,
            )}. Dropped: ${JSON.stringify(
              tab.droppedActions.map((action) => ({
                kind: action.kind,
                outcome: action.outcome,
                waitedMs: action.settledAtMs - action.seenAtMs,
              })),
            )}`,
          ).toBeGreaterThan(0);

          // Layer 2, product truth: the CLI prints the platform's own bytes, so
          // which leg carried an action is readable from the tool card the
          // agent saw. This is the only agent-visible carrier of `executedVia`.
          const beforeClose = dispatchOutcomes(
            langy.state.toolOutputs.slice(0, handover.dispatches),
          );
          expect(
            beforeClose.filter((output) => output.includes(BROWSER_MARKER))
              .length,
            `no action reported "executedVia":"browser" while the page was open, out of ${beforeClose.length} dispatches`,
          ).toBeGreaterThan(0);

          const afterClose = dispatchOutcomes(
            langy.state.toolOutputs.slice(handover.dispatches),
          );
          expect(
            afterClose.length,
            "Langy dispatched no page action after the user stepped away, so the handover was never exercised",
          ).toBeGreaterThan(0);
          expect(
            afterClose.filter((output) => output.includes(BROWSER_MARKER)),
            "an action reported the browser leg after the page had closed",
          ).toEqual([]);
          expect(
            afterClose.filter((output) => output.includes(BACKEND_MARKER))
              .length,
            `no action reported "executedVia":"backend" after the page closed, out of ${afterClose.length} dispatches`,
          ).toBeGreaterThan(0);

          // Layer 2, the outcome: the same end state the no-page suite asserts.
          // That is what makes the parity claim structural rather than a second
          // conversation graded by a second judge.
          await expectOptimizedWorkbench({
            slug: seeded.experimentSlug,
            baselineTargetId: seeded.baselineTargetId,
            datasetId: seeded.datasetId,
            baselineBefore,
          });

          const runId = await newestRunId(seeded.experimentSlug);
          expect(runId, "no run was recorded for the experiment").toBeDefined();
          await expectRunHasRealScores({
            slug: seeded.experimentSlug,
            runId: runId!,
          });

          // The refusal's outcome, whether or not Langy ever tried it: an
          // evaluator that cannot own a comparison must not be carrying one.
          const after = await getWorkbenchState(seeded.experimentSlug);
          const wrongCarrier = after.state.evaluators.filter(
            (evaluator) =>
              evaluator.comparison !== undefined &&
              !evaluator.evaluatorType.includes("compare"),
          );
          expect(
            wrongCarrier,
            "an evaluator that cannot be a standalone comparison column is carrying a comparison config",
          ).toEqual([]);

          // Layer 1 last: the conversation itself, graded against the loop
          // rubric plus the two criteria about where the work happened.
          expect(result.success).toBe(true);
        } finally {
          await tab.close();
        }
      },
      LIVE_LOOP_TIMEOUT_MS,
    );
  });

  describe("when a comparison config is put on an evaluator that cannot own one", () => {
    /** @scenario The save boundary refuses a comparison config in the dispatch's own words */
    it("refuses the save and the dispatch with the same wording", async () => {
      const seeded = await seedOptimizationWorkbench({
        name: "comparison-refusal",
        rows: 4,
        goldenStyle: "label",
        withEvaluator: true,
      });
      const before = await getWorkbenchState(seeded.experimentSlug);

      // The save boundary. `exact_match` grades one column against a golden; it can
      // never be a column that judges other columns against each other.
      const state = before.state as unknown as {
        evaluators: Record<string, unknown>[];
      };
      state.evaluators.push({
        id: "evaluator-wrong-comparison",
        evaluatorType: "langevals/exact_match",
        inputs: [
          { identifier: "output", type: "str" },
          { identifier: "expected_output", type: "str" },
        ],
        mappings: {},
        comparison: {
          variants: [seeded.baselineTargetId],
          hasGoldenAnswer: false,
          includeMetrics: [],
          randomizeOrder: true,
        },
      });
      const refused = await request({
        method: "PUT",
        path: `/api/experiments/${seeded.experimentSlug}/workbench-state`,
        body: { state, expectedVersion: before.version },
      });
      expect(refused.status).toBe(400);
      // Parsed rather than matched as a substring: the refusal quotes the field
      // name, and those quotes come back escaped inside the JSON body.
      const body = (await refused.json()) as {
        error?: string;
        issues?: { path?: string; message?: string }[];
      };
      expect(body.error).toBe("experiment_invalid_workbench_state");
      expect(
        (body.issues ?? []).map((issue) => issue.message),
        `the refusal did not carry the shared wording: ${JSON.stringify(body)}`,
      ).toContainEqual(expect.stringContaining(COMPARISON_COLUMN_REFUSAL));

      // The dispatch boundary, which refuses BEFORE anything reaches the stream, so
      // a page never sees the action at all. Same schema the UI-action service
      // parses the payload with.
      const parsed = addEvaluatorPayloadSchema.safeParse({
        evaluatorType: "langevals/exact_match",
        comparison: { variants: [seeded.baselineTargetId] },
      });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
        COMPARISON_COLUMN_REFUSAL,
      );
    });
  });
});
