/**
 * The other half of the code access card: the developer picks GitHub and asks
 * to be remembered, so the next conversation never sees the card again, and
 * clearing the choice brings it back (ADR-129).
 *
 * The facts are the conversation's own local-control state: whether a control
 * request was recorded, and what the remembered preference reads as. No
 * command line runs here, because GitHub is the path that needs none.
 *
 * RUN (one file per vitest run, see README):
 *   cd platform/app/e2e/langy && npx vitest run langy-code-access-github.scenario.test.ts --reporter=verbose
 */

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeLangyAdapter } from "./langy-agent";
import {
  LANGY_CORE_RULE_CRITERIA,
  LANGY_OPEN_PR_CRITERIA,
} from "./langy-rules";
import {
  getLocalWorkspace,
  setCodeAccessPreference,
  waitForPendingRequest,
} from "./local-control-fixture";
import { runScenarioAndLog } from "./scenario-logger";

const model = openai("gpt-5-mini");

const TURN_BUDGET_MS = 1_200_000;

const ASK = "instrument my traces with langwatch";

describe("Langy remembers that the developer works through GitHub", () => {
  beforeAll(async () => {
    await setCodeAccessPreference(null);
  });

  afterAll(async () => {
    // The preference is per user and outlives the run, so it is put back the
    // way every other suite expects to find it.
    await setCodeAccessPreference(null);
  });

  describe("when the developer picks GitHub and asks to be remembered", () => {
    /** @scenario A scenario checks that a remembered GitHub choice is not asked again */
    it(
      "asks once, then follows GitHub with no card, until the choice is cleared",
      async () => {
        const first = makeLangyAdapter();
        let firstConversationId = "";

        const asked = await runScenarioAndLog({
          config: {
            name: "the code access card is answered with GitHub",
            description:
              "A developer asks Langy to instrument their traces. Langy offers the two ways to reach the code. The developer picks GitHub and asks Langy to remember it.",
            agents: [
              first,
              scenario.userSimulatorAgent({ model }),
              scenario.judgeAgent({
                model,
                criteria: [
                  "Langy explains, once, that it can make the change on the developer's machine or through GitHub.",
                  "After the developer picks GitHub, Langy follows the GitHub path and does not offer the folder again.",
                  // The second turn IS the open-pull-request flow, so it is
                  // graded by that flow's rubric: on a machine where the
                  // GitHub App is not installed the platform stops the turn,
                  // and naming that blocker is the answer.
                  ...LANGY_OPEN_PR_CRITERIA,
                ],
              }),
            ],
            script: [
              scenario.user(ASK),
              scenario.agent(),
              async () => {
                firstConversationId = first.state.conversationId ?? "";
                expect(firstConversationId).not.toBe("");
                // Layer 2: the card recorded a request, which is what the
                // choice is answered against.
                const request = await waitForPendingRequest({
                  conversationId: firstConversationId,
                });
                expect(request.id).not.toBe("");
                // Picking GitHub with "remember" ticked: the preference is
                // stored, and the selection travels as the next message.
                await setCodeAccessPreference("github");
              },
              scenario.user("Use GitHub. Remember this choice."),
              scenario.agent(),
              scenario.judge(),
            ],
          },
        });
        if (!asked.success) console.log("JUDGE REASONING:", asked.reasoning);
        expect(asked.success).toBe(true);

        // The choice is stored on the person, not on the conversation.
        const afterChoice = await getLocalWorkspace(firstConversationId);
        expect(afterChoice.codeAccessPreference).toBe("github");

        // A SECOND conversation with a code ask: no card, no request.
        const second = makeLangyAdapter();
        const remembered = await runScenarioAndLog({
          config: {
            name: "a remembered GitHub choice asks nothing",
            description:
              "The same developer, in a new conversation, asks for a code change again. Langy already knows they work through GitHub, so it must not ask how to reach the code.",
            agents: [
              second,
              scenario.userSimulatorAgent({ model }),
              scenario.judgeAgent({
                model,
                criteria: [
                  "Langy does not ask how to reach the code: it already knows the developer uses GitHub.",
                  ...LANGY_OPEN_PR_CRITERIA,
                ],
              }),
            ],
            script: [
              scenario.user("add langwatch tracing to my support agent"),
              scenario.agent(),
              scenario.judge(),
            ],
          },
        });
        const secondConversationId = second.state.conversationId ?? "";
        const rememberedStatus = await getLocalWorkspace(secondConversationId);
        console.log(
          "[layer2] second conversation:",
          JSON.stringify({
            preference: rememberedStatus.codeAccessPreference,
            pendingRequest: rememberedStatus.pendingRequest,
            tools: second.state.toolNames.join(", "),
          }),
        );
        // The card is what records a request, so no request is the durable
        // proof that no card was rendered.
        expect(rememberedStatus.pendingRequest).toBeNull();
        expect(rememberedStatus.codeAccessPreference).toBe("github");
        if (!remembered.success) {
          console.log("JUDGE REASONING:", remembered.reasoning);
        }
        expect(remembered.success).toBe(true);

        // Change clears the choice, and the card comes back.
        await setCodeAccessPreference(null);
        const third = makeLangyAdapter();
        await runScenarioAndLog({
          config: {
            name: "clearing the choice asks again",
            description:
              "The developer cleared the remembered choice. The next code ask must offer the two ways again.",
            agents: [
              third,
              scenario.userSimulatorAgent({ model }),
              scenario.judgeAgent({
                model,
                criteria: [
                  "Langy offers the two ways to reach the code again.",
                  ...LANGY_CORE_RULE_CRITERIA,
                ],
              }),
            ],
            script: [scenario.user(ASK), scenario.agent(), scenario.judge()],
          },
        });
        const thirdRequest = await waitForPendingRequest({
          conversationId: third.state.conversationId ?? "",
        });
        expect(thirdRequest.id).not.toBe("");
      },
      TURN_BUDGET_MS * 3,
    );
  });
});
