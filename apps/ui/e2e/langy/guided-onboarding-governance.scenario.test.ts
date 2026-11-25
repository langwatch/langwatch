/**
 * The governance path of the guided onboarding. See README.md
 * "Scenario notes" (governance) for what it covers and why, and the "Run"
 * section above for how to run one file.
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
import { type ConversationWatcher, watchLangyConversation } from "./local-control-fixture";
import { runScenarioAndLog } from "./scenario-logger";
import { lastAssistantText } from "./scenario-transcript";

const model = openai("gpt-5-mini");

const CODING_START_OPTION = "Track my coding agent";

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
    /** @scenario The governance path asks how to start, records it, and ends with one line */
    it("asks how to start, records the coding start, closes the path and says the one line", async () => {
      const langy = makeLangyAdapter();
      watcher = watchLangyConversation({
        adapter: langy,
        answerQuestion: () => [CODING_START_OPTION],
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
            "Someone who just signed up picked Governance. The app sends Langy the guided onboarding kickoff; nothing was typed by the person. The tour has already walked the governance pages, so Langy asks how they want to start, records the answer, closes the path and says one line.",
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                `Langy says, word for word: "${GUIDED_LINES.governanceLine}"`,
                `Langy asks one question, with the replies "${CODING_START_OPTION}" and "Book a call for the company setup", and opens no page.`,
                "Langy never says or implies that a call is booked.",
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

      expect(watcher.questions).toHaveLength(1);
      expect(langy.state.navigateHrefs).toHaveLength(0);
      const recorded = langy.state.toolCommands.findIndex((command) =>
        /langwatch onboarding start coding/.test(command),
      );
      const closed = langy.state.toolCommands.findIndex((command) =>
        /langwatch onboarding complete-path governance/.test(command),
      );
      expect(recorded).toBeGreaterThan(-1);
      expect(closed).toBeGreaterThan(recorded);
      expect(
        langy.state.toolCommands.some((command) =>
          /langwatch onboarding complete-path governance/.test(command),
        ),
      ).toBe(true);
      assertPathCompletedAfterSkill({
        events: mergeToolEvents(langy.state.toolEvents, watcher.toolEvents),
        path: "governance",
      });
      expect(saysVerbatim(lastAssistantText(result), GUIDED_LINES.governanceLine)).toBe(true);
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
