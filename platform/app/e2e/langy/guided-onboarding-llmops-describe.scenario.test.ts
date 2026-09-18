/**
 * The describe fallback of the llmops path: the developer would rather
 * describe the agent than share the code, Langy takes the one line, then
 * explains that it still needs the code and asks how to connect, offering
 * the folder and GitHub again without the describe way out.
 *
 * Layer 2 is the stored conversation: two `code_access` calls, the first
 * with the describe offer and the second without, and the control request
 * the second one opened. Nothing is created on the project.
 *
 * RUN (one file per vitest run, see README):
 *   cd platform/app/e2e/langy && npx vitest run guided-onboarding-llmops-describe.scenario.test.ts --reporter=verbose
 */

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  attachKickoffConversation,
  conversationMessages,
  GUIDED_LINES,
  GUIDED_OPTIONS,
  GUIDED_TONE_CRITERIA,
  type GuidedOrganization,
  listProjectScenarios,
  pathCompletions,
  queueGuidedKickoff,
  saysVerbatim,
  seedGuidedOrganization,
} from "./guided-onboarding-fixture";
import { makeLangyAdapter } from "./langy-agent";
import {
  getLocalWorkspace,
  setCodeAccessPreference,
  waitForPendingRequest,
} from "./local-control-fixture";
import { runScenarioAndLog } from "./scenario-logger";
import { allAssistantText } from "./scenario-transcript";

const model = openai("gpt-5-mini");

const DESCRIPTION =
  "It's a LangGraph checkout agent: guests add items to a cart, apply a discount code, pay and get an order number.";

let org: GuidedOrganization;

describe("Langy takes a description and still reaches for the code", () => {
  beforeAll(async () => {
    org = await seedGuidedOrganization({
      label: "LLM Ops describe",
      paths: ["llmops"],
      tour: "completed",
    });
    await setCodeAccessPreference(null);
  }, 180_000);

  afterAll(async () => {
    await setCodeAccessPreference(null);
  });

  describe("when the developer picks the describe option on the code access card", () => {
    /** @scenario The describe fallback still reaches the code */
    it("asks for one line, then asks how to connect and offers the folder and GitHub again", async () => {
      const langy = makeLangyAdapter();
      await queueGuidedKickoff({
        adapter: langy,
        org,
        path: "llmops",
        tourStatus: "completed",
      });
      let firstRequestId = "";

      const result = await runScenarioAndLog({
        config: {
          name: "guided onboarding: the describe fallback",
          description:
            'A developer just signed up and picked Evals & LLM Ops. The app sends Langy the guided onboarding kickoff. On the code access card the developer picks "I\'d rather describe it", which arrives as their own message, describes the agent in one line, and Langy must explain that it still needs the code and ask how to connect.',
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                `Langy opens with, word for word: "${GUIDED_LINES.llmopsOpener}"`,
                `After the developer picks "${GUIDED_OPTIONS.describe}", Langy says, word for word: "${GUIDED_LINES.describeAsk}"`,
                `After the one-line description, Langy says, word for word: "${GUIDED_LINES.describeConnect}" and shows the code access card again.`,
                "Langy creates nothing on the project and writes no scenario before it can reach the code.",
                ...GUIDED_TONE_CRITERIA,
              ],
            }),
          ],
          script: [
            scenario.agent(),
            async () => {
              await attachKickoffConversation({ org, adapter: langy });
              const conversationId = langy.state.conversationId ?? "";
              expect(langy.state.toolNames).toContain("code_access");
              firstRequestId = (await waitForPendingRequest({ conversationId }))
                .id;
            },
            // The card's quiet link sends these exact words as the
            // developer's own message.
            scenario.user(GUIDED_OPTIONS.describe),
            scenario.agent(),
            scenario.user(DESCRIPTION),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });

      const text = allAssistantText(result);
      expect(saysVerbatim(text, GUIDED_LINES.llmopsOpener)).toBe(true);
      expect(saysVerbatim(text, GUIDED_LINES.describeAsk)).toBe(true);
      expect(saysVerbatim(text, GUIDED_LINES.describeConnect)).toBe(true);

      const conversationId = langy.state.conversationId ?? "";
      const stored = await conversationMessages(conversationId);
      const codeAccessInputs = stored.flatMap((message) =>
        message.parts
          .filter((part) => part.type === "tool-code_access")
          .map(
            (part) => part.input as { offer_describe?: unknown } | undefined,
          ),
      );
      console.log(
        "[layer2] code_access inputs:",
        JSON.stringify(codeAccessInputs),
      );
      expect(codeAccessInputs.length).toBeGreaterThanOrEqual(2);
      expect(codeAccessInputs[0]?.offer_describe).toBe(true);
      expect(
        codeAccessInputs[codeAccessInputs.length - 1]?.offer_describe,
      ).not.toBe(true);

      // The second ask opened a control request of its own: the card is
      // back with the folder and GitHub, the developer never shared.
      const status = await getLocalWorkspace(conversationId);
      console.log("[layer2] workspace:", JSON.stringify(status));
      expect(status.connected).toBe(false);
      expect(status.pendingRequest).not.toBeNull();
      expect(firstRequestId).not.toBe("");
      expect(await listProjectScenarios()).toEqual([]);
      expect(pathCompletions(langy.state.toolEvents)).toEqual([]);

      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    }, 1_500_000);
  });
});
