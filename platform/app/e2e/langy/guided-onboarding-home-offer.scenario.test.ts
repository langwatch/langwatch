/**
 * The Home offer continues the guided conversation: once a path is done, the
 * offer on the next space begins its path and sends a second kickoff into
 * the SAME conversation, reading "Let's set up Gateway then.", and Langy
 * opens that path with its own script.
 *
 * The first path here is the coding one, the cheapest to complete; the
 * mechanism under test is the continuation, which is the same for every path.
 *
 * Layer 2 is the conversation id the organization recorded (the second
 * kickoff lands in it), the stored kickoff message for the gateway path
 * (what the panel renders as the second tour card), and the guided state.
 *
 * RUN (one file per vitest run, see README):
 *   cd platform/app/e2e/langy && npx vitest run guided-onboarding-home-offer.scenario.test.ts --reporter=verbose
 */

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { beforeAll, describe, expect, it } from "vitest";
import {
  guidedKickoffPartOf,
  guidedPathContinuationLine,
} from "~/features/guided-onboarding/kickoff";
import {
  attachKickoffConversation,
  beginGuidedPath,
  conversationMessages,
  GUIDED_LINES,
  GUIDED_TONE_CRITERIA,
  type GuidedOrganization,
  listVirtualKeys,
  queueGuidedKickoff,
  readGuidedState,
  saysVerbatim,
  seedGuidedOrganization,
  waitForPathDone,
} from "./guided-onboarding-fixture";
import { makeLangyAdapter } from "./langy-agent";
import { runScenarioAndLog } from "./scenario-logger";
import { allAssistantText, lastAssistantText } from "./scenario-transcript";

const model = openai("gpt-5-mini");

let org: GuidedOrganization;

describe("The Home offer continues the guided conversation", () => {
  beforeAll(async () => {
    org = await seedGuidedOrganization({
      label: "Home offer",
      paths: ["coding", "gateway"],
      currentPath: "coding",
      tour: "none",
    });
  }, 180_000);

  describe("when the gateway path starts from the Home offer after the coding path", () => {
    /** @scenario The Home offer continues the same conversation */
    it("sends the second kickoff into the attached conversation and Langy opens the gateway path", async () => {
      const langy = makeLangyAdapter();
      await queueGuidedKickoff({
        adapter: langy,
        org,
        path: "coding",
        tourStatus: "none",
      });
      let attachedConversationId = "";
      let continuationInput: { path: string } | null = null;

      const result = await runScenarioAndLog({
        config: {
          name: "guided onboarding: the Home offer continues the conversation",
          description:
            'Someone who just signed up picked Coding Agent Tracking first and Gateway second. Langy sets up the coding path from the kickoff. Later the person clicks the Home offer on the Gateway space, which sends a second kickoff into the same conversation reading "Let\'s set up Gateway then."; nothing else was typed by the person.',
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                `On the first kickoff Langy hands over the command "${GUIDED_LINES.codingCommand}" and closes the coding path.`,
                `On the second kickoff Langy opens the gateway path with its own script: it says, word for word, "${GUIDED_LINES.gatewayLive}", prints the environment snippet, and ends with "${GUIDED_LINES.gatewayClose}".`,
                "Langy never restarts the coding path and never asks which path to set up.",
                ...GUIDED_TONE_CRITERIA,
              ],
            }),
          ],
          script: [
            scenario.agent(),
            async () => {
              attachedConversationId = await attachKickoffConversation({
                org,
                adapter: langy,
              });
              await waitForPathDone({
                organizationId: org.organizationId,
                path: "coding",
              });
              // The Home offer: begin the path, then continue the attached
              // conversation with the path's kickoff.
              const state = await beginGuidedPath({
                organizationId: org.organizationId,
                path: "gateway",
              });
              expect(state.conversationId).toBe(attachedConversationId);
              expect(langy.state.conversationId).toBe(attachedConversationId);
              continuationInput = await queueGuidedKickoff({
                adapter: langy,
                org,
                path: "gateway",
                tourStatus: "completed",
                continuing: true,
              });
            },
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });

      // The continuation landed in the conversation the organization holds.
      expect(langy.state.conversationId).toBe(attachedConversationId);
      const finalState = await waitForPathDone({
        organizationId: org.organizationId,
        path: "gateway",
      });
      console.log("[layer2] guided state:", JSON.stringify(finalState));
      expect(finalState.conversationId).toBe(attachedConversationId);
      expect(finalState.donePaths).toEqual(["coding", "gateway"]);

      // The second kickoff is stored with its typed part, which is what the
      // panel renders as the gateway tour card in the same conversation.
      const messages = await conversationMessages(attachedConversationId);
      const kickoffs = messages
        .filter((message) => message.role === "user")
        .map((message) => ({
          part: guidedKickoffPartOf(message.parts),
          text: message.parts
            .filter((part) => typeof part.text === "string")
            .map((part) => String(part.text))
            .join("\n"),
        }))
        .filter((message) => message.part !== null);
      console.log(
        "[layer2] kickoffs:",
        JSON.stringify(kickoffs.map((k) => k.part?.path)),
      );
      expect(kickoffs.map((k) => k.part?.path)).toEqual(["coding", "gateway"]);
      expect(continuationInput?.path).toBe("gateway");
      expect(
        kickoffs[1]?.text.startsWith(guidedPathContinuationLine("gateway")),
      ).toBe(true);
      expect(guidedPathContinuationLine("gateway")).toBe(
        "Let's set up Gateway then.",
      );

      const keys = await listVirtualKeys(org.organizationId);
      expect(keys.filter((key) => key.name === "production-app")).toHaveLength(
        1,
      );
      const last = lastAssistantText(result);
      expect(saysVerbatim(last, GUIDED_LINES.gatewayLive)).toBe(true);
      expect(saysVerbatim(last, GUIDED_LINES.gatewayClose)).toBe(true);
      expect(allAssistantText(result)).toContain(GUIDED_LINES.codingCommand);

      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
      // Completing the current path clears it: nothing is being guided now.
      expect((await readGuidedState(org.organizationId)).currentPath).toBe(
        undefined,
      );
    }, 1_500_000);
  });
});
