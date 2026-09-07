/**
 * The coding path of the guided onboarding: the kickoff arrives with no tour
 * behind it, Langy hands over the one command and records the path as done.
 *
 * Layer 2 is the organization's guided state (the path is listed as done
 * because Langy ran `langwatch onboarding complete-path coding`) and the
 * conversation's title, which the kickoff names and the brief never replaces.
 *
 * RUN (one file per vitest run, see README):
 *   cd platform/app/e2e/langy && npx vitest run guided-onboarding-coding.scenario.test.ts --reporter=verbose
 */

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assertPathCompletedAfterSkill,
  attachKickoffConversation,
  conversationTitle,
  GUIDED_LINES,
  GUIDED_TONE_CRITERIA,
  type GuidedOrganization,
  queueGuidedKickoff,
  readGuidedState,
  saysVerbatim,
  seedGuidedOrganization,
  waitForPathDone,
} from "./guided-onboarding-fixture";
import { makeLangyAdapter } from "./langy-agent";
import { runScenarioAndLog } from "./scenario-logger";
import { allAssistantText } from "./scenario-transcript";

const model = openai("gpt-5-mini");

let org: GuidedOrganization;

describe("Langy sets up coding agent tracking from the kickoff", () => {
  beforeAll(async () => {
    org = await seedGuidedOrganization({
      label: "Coding",
      paths: ["coding"],
      tour: "none",
    });
  }, 180_000);

  describe("when the kickoff for the coding path arrives", () => {
    /** @scenario The coding path hands over the one command */
    /** @scenario Every path ends by recording its completion */
    it("prints the npx command between its two lines and records the path", async () => {
      const langy = makeLangyAdapter();
      await queueGuidedKickoff({
        adapter: langy,
        org,
        path: "coding",
        tourStatus: "none",
      });

      const result = await runScenarioAndLog({
        config: {
          name: "guided onboarding: the coding path",
          description:
            "A developer who just signed up picked Coding Agent Tracking. The app sends Langy the guided onboarding kickoff; nothing was typed by the person. Langy must hand over the one command and close the path.",
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                `Langy says, word for word: "${GUIDED_LINES.codingOpen}"`,
                `Langy prints the command "${GUIDED_LINES.codingCommand}" in a code block between its two lines.`,
                `Langy says, word for word: "${GUIDED_LINES.codingClose}"`,
                "Langy asks the user nothing and hands over no other step.",
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

      const text = allAssistantText(result);
      console.log("[layer2] tools:", langy.state.toolNames.join(", "));
      console.log("[layer2] commands:", langy.state.toolCommands.join(" | "));
      expect(saysVerbatim(text, GUIDED_LINES.codingOpen)).toBe(true);
      expect(text).toContain(GUIDED_LINES.codingCommand);
      expect(saysVerbatim(text, GUIDED_LINES.codingClose)).toBe(true);

      // The completion is a command Langy ran, not a line it wrote.
      expect(
        langy.state.toolCommands.some((command) =>
          /langwatch onboarding complete-path coding/.test(command),
        ),
      ).toBe(true);
      assertPathCompletedAfterSkill({
        events: langy.state.toolEvents,
        path: "coding",
      });
      const state = await waitForPathDone({
        organizationId: org.organizationId,
        path: "coding",
      });
      console.log("[layer2] guided state:", JSON.stringify(state));
      expect(state.donePaths).toContain("coding");
      expect(state.conversationId).toBe(langy.state.conversationId);

      const title = await conversationTitle(langy.state.conversationId ?? "");
      console.log("[layer2] title:", title);
      expect(title).toBe("Getting started");

      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
      expect((await readGuidedState(org.organizationId)).donePaths).toEqual([
        "coding",
      ]);
    }, 900_000);
  });
});
