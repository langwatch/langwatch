/**
 * The governance path of the guided onboarding: Langy asks where to start
 * with the two sources, the user picks one on the card, Langy opens the
 * sources page and records the path as done.
 *
 * Layer 2 is the question card the watcher answered (its options, in
 * order), the navigate instruction on the turn stream, and the guided state.
 *
 * RUN (one file per vitest run, see README):
 *   cd platform/app/e2e/langy && npx vitest run guided-onboarding-governance.scenario.test.ts --reporter=verbose
 */

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertPathCompletedAfterSkill,
  attachKickoffConversation,
  GOVERNANCE_SOURCES_PATH,
  GUIDED_LINES,
  GUIDED_OPTIONS,
  GUIDED_TONE_CRITERIA,
  type GuidedOrganization,
  mergeToolEvents,
  queueGuidedKickoff,
  saysVerbatim,
  seedGuidedOrganization,
  waitForPathDone,
} from "./guided-onboarding-fixture";
import { makeLangyAdapter } from "./langy-agent";
import {
  type ConversationWatcher,
  watchLangyConversation,
} from "./local-control-fixture";
import { runScenarioAndLog } from "./scenario-logger";

const model = openai("gpt-5-mini");

let org: GuidedOrganization;
let watcher: ConversationWatcher | undefined;

describe("Langy sets up governance from the kickoff", () => {
  beforeAll(async () => {
    org = await seedGuidedOrganization({
      label: "Governance",
      paths: ["governance"],
      tour: "completed",
    });
  }, 180_000);

  afterAll(() => {
    watcher?.stop();
  });

  describe("when the kickoff for the governance path arrives", () => {
    /** @scenario The governance path asks where to start */
    it("asks with the two sources, opens the sources page on the pick, and records the path", async () => {
      const langy = makeLangyAdapter();
      watcher = watchLangyConversation({
        adapter: langy,
        answerQuestion: () => [GUIDED_OPTIONS.identityProvider],
      });
      await queueGuidedKickoff({
        adapter: langy,
        org,
        path: "governance",
        tourStatus: "completed",
      });

      const result = await runScenarioAndLog({
        config: {
          name: "guided onboarding: the governance path",
          description:
            "Someone who just signed up picked Governance. The app sends Langy the guided onboarding kickoff; nothing was typed by the person. Langy asks where to start with a question card, the person picks the identity provider on the card, and Langy opens the sources page.",
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                `Langy asks, word for word: "${GUIDED_LINES.governanceAsk}"`,
                "After the pick, Langy says in one line which source to add first on the sources page and ends there.",
                "Langy creates nothing and asks no second question.",
                ...GUIDED_TONE_CRITERIA,
              ],
            }),
          ],
          script: [
            scenario.agent(),
            async (_state, executor) => {
              await attachKickoffConversation({ org, adapter: langy });
              // The pick happened on a card, which the judge cannot see.
              for (const note of watcher!.drainAnswerNotes()) {
                await executor.message({ role: "user", content: note });
              }
            },
            scenario.judge(),
          ],
        },
      });

      console.log(
        "[layer2] questions:",
        JSON.stringify(watcher.questions.map((ask) => ask.questions)),
      );
      console.log("[layer2] navigate:", langy.state.navigateHrefs.join(", "));
      console.log("[layer2] commands:", langy.state.toolCommands.join(" | "));

      expect(langy.state.toolNames).toContain("question");
      const question = watcher.questions[0]?.questions[0];
      expect(question).toBeDefined();
      expect(saysVerbatim(question!.question, GUIDED_LINES.governanceAsk)).toBe(
        true,
      );
      expect(question!.options?.map((option) => option.label)).toEqual([
        GUIDED_OPTIONS.identityProvider,
        GUIDED_OPTIONS.billingExport,
      ]);

      expect(
        langy.state.navigateHrefs.some((href) =>
          href.includes(GOVERNANCE_SOURCES_PATH),
        ),
      ).toBe(true);
      expect(
        langy.state.toolCommands.some((command) =>
          /langwatch onboarding complete-path governance/.test(command),
        ),
      ).toBe(true);
      assertPathCompletedAfterSkill({
        events: mergeToolEvents(langy.state.toolEvents, watcher.toolEvents),
        path: "governance",
      });
      const state = await waitForPathDone({
        organizationId: org.organizationId,
        path: "governance",
      });
      expect(state.donePaths).toContain("governance");

      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    }, 900_000);
  });
});
