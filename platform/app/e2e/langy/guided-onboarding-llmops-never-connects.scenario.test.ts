/**
 * The llmops path when the folder never connects: the code access card's
 * request runs out with nothing shared, the developer says so, and Langy
 * offers GitHub in one line and asks again. Nothing is created on the
 * project until the code is reachable.
 *
 * The request's expiry is fifteen minutes; the fixture cancels the open
 * request instead, which leaves the conversation in the same state the card
 * shows when it reads "Request expired, ask again".
 *
 * RUN (one file per vitest run, see README):
 *   cd platform/app/e2e/langy && npx vitest run guided-onboarding-llmops-never-connects.scenario.test.ts --reporter=verbose
 */

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  attachKickoffConversation,
  GUIDED_LINES,
  GUIDED_TONE_CRITERIA,
  type GuidedOrganization,
  listProjectScenarios,
  listProjectSuites,
  queueGuidedKickoff,
  readGuidedState,
  saysVerbatim,
  seedGuidedOrganization,
} from "./guided-onboarding-fixture";
import { makeLangyAdapter } from "./langy-agent";
import {
  cancelOpenControlRequests,
  getLocalWorkspace,
  setCodeAccessPreference,
  waitForPendingRequest,
} from "./local-control-fixture";
import { runScenarioAndLog } from "./scenario-logger";
import { allAssistantText, lastAssistantText } from "./scenario-transcript";

const model = openai("gpt-5-mini");

let org: GuidedOrganization;

describe("Langy offers GitHub when the folder never connects", () => {
  beforeAll(async () => {
    org = await seedGuidedOrganization({
      label: "LLM Ops no folder",
      paths: ["llmops"],
      tour: "completed",
    });
    await setCodeAccessPreference(null);
  }, 180_000);

  afterAll(async () => {
    await setCodeAccessPreference(null);
  });

  describe("when the request runs out with no folder connected", () => {
    /** @scenario A folder that never connects gets the GitHub offer */
    it("offers GitHub in one line, asks again, and creates nothing", async () => {
      const langy = makeLangyAdapter();
      await queueGuidedKickoff({
        adapter: langy,
        org,
        path: "llmops",
        tourStatus: "completed",
      });
      let expiredRequestId = "";

      const result = await runScenarioAndLog({
        config: {
          name: "guided onboarding: the folder never connects",
          description:
            "A developer just signed up and picked Evals & LLM Ops. The app sends Langy the guided onboarding kickoff. The developer never gets the share command to run, the code access request expires, and the developer says so. Langy must offer GitHub in one line, ask for the code again, and create nothing.",
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                `Langy opens with, word for word: "${GUIDED_LINES.llmopsOpener}"`,
                "When the developer says the request expired, Langy offers GitHub as the other way in, in one line, and asks for the code again through the card; it does not repeat manual steps or a long explanation.",
                "Langy creates no scenario, no suite and nothing else on the project while it cannot reach the code.",
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
              expiredRequestId = (
                await waitForPendingRequest({ conversationId })
              ).id;
              // The request runs out: the card reads "Request expired, ask
              // again" and the conversation holds no request any more.
              await cancelOpenControlRequests();
              const status = await getLocalWorkspace(conversationId);
              expect(status.pendingRequest).toBeNull();
            },
            scenario.user(
              "The request expired, I never managed to run that command on my machine.",
            ),
            scenario.agent(),
            scenario.judge(),
          ],
        },
      });

      const text = allAssistantText(result);
      const reply = lastAssistantText(result);
      console.log("[layer2] tools:", langy.state.toolNames.join(", "));
      console.log("[layer2] commands:", langy.state.toolCommands.join(" | "));
      expect(saysVerbatim(text, GUIDED_LINES.llmopsOpener)).toBe(true);
      expect(reply).toMatch(/github/i);
      expect(
        langy.state.toolNames.filter((name) => name === "code_access").length,
      ).toBeGreaterThanOrEqual(2);

      const conversationId = langy.state.conversationId ?? "";
      const status = await getLocalWorkspace(conversationId);
      console.log("[layer2] workspace:", JSON.stringify(status));
      expect(status.connected).toBe(false);
      expect(status.pendingRequest).not.toBeNull();
      expect(status.pendingRequest?.id).not.toBe(expiredRequestId);

      expect(await listProjectScenarios()).toEqual([]);
      expect(await listProjectSuites()).toEqual([]);
      expect((await readGuidedState(org.organizationId)).donePaths).toEqual([]);
      expect(
        langy.state.toolCommands.some((c) =>
          /scenario create|test-suite/.test(c),
        ),
      ).toBe(false);

      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    }, 1_500_000);
  });
});
