/**
 * The governance path of the guided onboarding: the tour walks the pages,
 * so Langy's part is one line. It records the path as done and says the
 * line, and nothing else: no question, no page opened.
 *
 * Layer 2 is the absence of a question card and a navigate instruction on
 * the turn stream, the complete-path call, and the guided state.
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
  GUIDED_LINES,
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
import { lastAssistantText } from "./scenario-transcript";

const model = openai("gpt-5-mini");

let org: GuidedOrganization;
let watcher: ConversationWatcher | undefined;

describe("Langy closes the governance path from the kickoff", () => {
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
    /** @scenario The governance path ends with one line */
    it("records the path and says the one line, with no question and no page opened", async () => {
      const langy = makeLangyAdapter();
      watcher = watchLangyConversation({
        adapter: langy,
        answerQuestion: () => [],
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
            "Someone who just signed up picked Governance. The app sends Langy the guided onboarding kickoff; nothing was typed by the person. The tour has already walked the governance pages, so Langy only records the path and says one line.",
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                `Langy says, word for word: "${GUIDED_LINES.governanceLine}"`,
                "Langy asks no question, opens no page and creates nothing.",
                "Langy ends the turn on that line, with nothing after it.",
                ...GUIDED_TONE_CRITERIA,
              ],
            }),
          ],
          script: [
            scenario.agent(),
            async () => {
              await attachKickoffConversation({ org, adapter: langy });
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

      expect(langy.state.toolNames).not.toContain("question");
      expect(watcher.questions).toHaveLength(0);
      expect(langy.state.navigateHrefs).toHaveLength(0);
      expect(
        langy.state.toolCommands.some((command) =>
          /langwatch onboarding complete-path governance/.test(command),
        ),
      ).toBe(true);
      assertPathCompletedAfterSkill({
        events: mergeToolEvents(langy.state.toolEvents, watcher.toolEvents),
        path: "governance",
      });
      expect(
        saysVerbatim(lastAssistantText(result), GUIDED_LINES.governanceLine),
      ).toBe(true);
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
