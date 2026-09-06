/**
 * The gateway path of the guided onboarding, twice: once after a tour that
 * already minted the `production-app` key, once after a skipped tour that
 * minted nothing. Langy checks before it mints, prints the snippet and
 * records the path as done either way.
 *
 * Layer 2 is the organization's virtual keys (never a second
 * `production-app`), the commands Langy ran, and the guided state.
 *
 * RUN (one file per vitest run, see README):
 *   cd platform/app/e2e/langy && npx vitest run guided-onboarding-gateway.scenario.test.ts --reporter=verbose
 */

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { describe, expect, it } from "vitest";
import {
  attachKickoffConversation,
  GUIDED_LINES,
  GUIDED_TONE_CRITERIA,
  listVirtualKeys,
  mintVirtualKey,
  queueGuidedKickoff,
  saysVerbatim,
  seedGuidedOrganization,
  waitForPathDone,
} from "./guided-onboarding-fixture";
import { makeLangyAdapter } from "./langy-agent";
import { runScenarioAndLog } from "./scenario-logger";
import { allAssistantText } from "./scenario-transcript";

const model = openai("gpt-5-mini");

const KEY_NAME = "production-app";

const GATEWAY_CRITERIA = [
  `Langy says, word for word: "${GUIDED_LINES.gatewayLive}"`,
  "Langy prints an environment snippet in a code block that sets the OpenAI base URL to the gateway and the API key to the production-app key.",
  `Langy ends with, word for word: "${GUIDED_LINES.gatewayClose}"`,
  "Langy asks the user nothing.",
  ...GUIDED_TONE_CRITERIA,
];

/** The index of the first command matching, or -1. */
function firstCommand(commands: string[], pattern: RegExp): number {
  return commands.findIndex((command) => pattern.test(command));
}

describe("Langy sets up the gateway from the kickoff", () => {
  describe("when the tour already minted the production-app key", () => {
    /** @scenario The gateway path prints the key and the snippet */
    it("checks first, mints nothing, prints the snippet and records the path", async () => {
      const org = await seedGuidedOrganization({
        label: "Gateway",
        paths: ["gateway"],
        tour: "completed",
      });
      await mintVirtualKey({
        organizationId: org.organizationId,
        name: KEY_NAME,
      });

      const langy = makeLangyAdapter();
      await queueGuidedKickoff({
        adapter: langy,
        org,
        path: "gateway",
        tourStatus: "completed",
      });

      const result = await runScenarioAndLog({
        config: {
          name: "guided onboarding: the gateway path after the tour minted the key",
          description:
            "Someone who just signed up picked Gateway. The tour already created a virtual key named production-app. The app sends Langy the guided onboarding kickoff; nothing was typed by the person.",
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                "Langy does not create a second virtual key: the production-app key already exists and Langy says in one line that its secret was shown at minting.",
                ...GATEWAY_CRITERIA,
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

      const commands = langy.state.toolCommands;
      console.log("[layer2] commands:", commands.join(" | "));
      const listAt = firstCommand(commands, /virtual-keys list/);
      const createAt = firstCommand(commands, /virtual-keys create/);
      expect(listAt).toBeGreaterThanOrEqual(0);
      expect(createAt).toBe(-1);

      const keys = await listVirtualKeys(org.organizationId);
      console.log("[layer2] keys:", keys.map((key) => key.name).join(", "));
      expect(keys.filter((key) => key.name === KEY_NAME)).toHaveLength(1);

      const text = allAssistantText(result);
      expect(saysVerbatim(text, GUIDED_LINES.gatewayLive)).toBe(true);
      expect(text).toMatch(/OPENAI_BASE_URL/);
      expect(text).toMatch(/OPENAI_API_KEY/);
      expect(saysVerbatim(text, GUIDED_LINES.gatewayClose)).toBe(true);
      expect(
        commands.some((command) =>
          /langwatch onboarding complete-path gateway/.test(command),
        ),
      ).toBe(true);
      const state = await waitForPathDone({
        organizationId: org.organizationId,
        path: "gateway",
      });
      expect(state.donePaths).toContain("gateway");

      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    }, 900_000);
  });

  describe("when the tour was skipped and no key exists", () => {
    /** @scenario The gateway path mints the key when the tour did not */
    /** @scenario A skipped tour gets the no-worries line */
    it("says no worries, mints production-app once, and prints the snippet with it", async () => {
      const org = await seedGuidedOrganization({
        label: "Gateway skipped",
        paths: ["gateway"],
        tour: "skipped",
      });

      const langy = makeLangyAdapter();
      await queueGuidedKickoff({
        adapter: langy,
        org,
        path: "gateway",
        tourStatus: "skipped",
      });

      const result = await runScenarioAndLog({
        config: {
          name: "guided onboarding: the gateway path after a skipped tour",
          description:
            "Someone who just signed up picked Gateway and skipped the tour, so no virtual key exists yet. The app sends Langy the guided onboarding kickoff; nothing was typed by the person.",
          agents: [
            langy,
            scenario.userSimulatorAgent({ model }),
            scenario.judgeAgent({
              model,
              criteria: [
                `Langy opens with, word for word: "${GUIDED_LINES.skippedTour}"`,
                "Langy creates one virtual key named production-app and prints its secret in the snippet.",
                ...GATEWAY_CRITERIA,
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

      const commands = langy.state.toolCommands;
      console.log("[layer2] commands:", commands.join(" | "));
      const listAt = firstCommand(commands, /virtual-keys list/);
      const createAt = firstCommand(commands, /virtual-keys create/);
      expect(listAt).toBeGreaterThanOrEqual(0);
      expect(createAt).toBeGreaterThan(listAt);
      expect(commands[createAt]).toMatch(/--name production-app/);

      const keys = await listVirtualKeys(org.organizationId);
      console.log("[layer2] keys:", keys.map((key) => key.name).join(", "));
      expect(keys.filter((key) => key.name === KEY_NAME)).toHaveLength(1);

      const text = allAssistantText(result);
      expect(saysVerbatim(text, GUIDED_LINES.skippedTour)).toBe(true);
      expect(text.indexOf(GUIDED_LINES.skippedTour.slice(0, 12))).toBeLessThan(
        text.indexOf("production-app"),
      );
      expect(saysVerbatim(text, GUIDED_LINES.gatewayLive)).toBe(true);
      expect(text).toMatch(/OPENAI_API_KEY="?[A-Za-z0-9_-]{16,}/);
      expect(saysVerbatim(text, GUIDED_LINES.gatewayClose)).toBe(true);
      const state = await waitForPathDone({
        organizationId: org.organizationId,
        path: "gateway",
      });
      expect(state.donePaths).toContain("gateway");

      if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
      expect(result.success).toBe(true);
    }, 900_000);
  });
});
