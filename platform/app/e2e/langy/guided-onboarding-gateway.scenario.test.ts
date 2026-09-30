/**
 * The gateway path of the guided onboarding, three times: after a tour that
 * already minted the `production-app` key, with the kickoff composed from
 * the state as the suite reads it; the same, with the kickoff composed from
 * the snapshot the panel holds before the tour records the key, which the
 * server settles; and after a skipped tour that minted nothing. Langy shows
 * the snippet through the secret snippet card and records the path as done
 * every time. The secret itself is never in a message: the card reads it
 * once by its reveal id.
 *
 * Layer 2 is the organization's virtual keys (never a second
 * `production-app`), the commands Langy ran, the secret snippet call, and
 * the guided state.
 *
 * RUN (one file per vitest run, see README):
 *   cd platform/app/e2e/langy && npx vitest run guided-onboarding-gateway.scenario.test.ts --reporter=verbose
 */

import * as scenario from "@langwatch/scenario";
import { describe, expect, it } from "vitest";
import {
  assertPathCompletedAfterSkill,
  attachKickoffConversation,
  expectNoSecretInText,
  expectSecretSnippetOnThisGateway,
  GUIDED_LINES,
  gatewayPublicUrl,
  listVirtualKeys,
  queueGuidedKickoff,
  saysVerbatim,
  seedGuidedOrganization,
  waitForPathDone,
} from "./guided-onboarding-fixture";
import {
  expectGatewayPathFromTheRevealInHand,
  firstCommand,
  GATEWAY_CRITERIA,
  KEY_NAME,
  model,
} from "./guided-onboarding-gateway.fixture";
import { makeLangyAdapter } from "./langy-agent";
import { runScenarioAndLog } from "./scenario-logger";
import { allAssistantText } from "./scenario-transcript";

describe("Langy sets up the gateway from the kickoff", () => {
  describe("when the tour already minted the production-app key", () => {
    /** @scenario The gateway path prints the key and the snippet */
    it("shows the snippet from the reveal id in hand, looks nothing up, mints nothing and records the path", async () => {
      await expectGatewayPathFromTheRevealInHand({
        label: "Gateway",
        name: "guided onboarding: the gateway path after the tour minted the key",
        description: "",
        snapshot: "current",
      });
    }, 900_000);

    /** @scenario The suite sends the panel's snapshot from before the key and the server settles it */
    it("shows the snippet from the reveal id on the guided state when the kickoff was composed before the key, as the panel composes it live", async () => {
      await expectGatewayPathFromTheRevealInHand({
        label: "Gateway snapshot",
        name: "guided onboarding: the gateway path from the panel's snapshot before the key",
        description:
          ", composed from the state the panel held before the tour recorded the key, so the brief as sent says none was minted and the server settles it",
        snapshot: "before-the-key",
      });
    }, 900_000);
  });

  describe("when the tour was skipped and no key exists", () => {
    /** @scenario The gateway path mints the key when the tour did not */
    /** @scenario A skipped tour gets the no-worries line */
    it("says no worries, mints production-app once with a one-time reveal, and shows the snippet through the card", async () => {
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
                "Langy creates one virtual key named production-app and shows the snippet for it through the secret snippet card, never the secret itself.",
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
      expect(commands[createAt]).toMatch(/--reveal-once/);

      const keys = await listVirtualKeys(org.organizationId);
      console.log("[layer2] keys:", keys.map((key) => key.name).join(", "));
      expect(keys.filter((key) => key.name === KEY_NAME)).toHaveLength(1);

      const text = allAssistantText(result);
      expect(saysVerbatim(text, GUIDED_LINES.skippedTour)).toBe(true);
      expect(text.indexOf(GUIDED_LINES.skippedTour.slice(0, 12))).toBeLessThan(
        text.indexOf("production-app"),
      );
      expect(saysVerbatim(text, GUIDED_LINES.gatewayLive)).toBe(true);
      expectSecretSnippetOnThisGateway({
        events: langy.state.toolEvents,
        gatewayUrl: await gatewayPublicUrl(),
      });
      expectNoSecretInText(text);
      expect(saysVerbatim(text, GUIDED_LINES.gatewayClose)).toBe(true);
      assertPathCompletedAfterSkill({
        events: langy.state.toolEvents,
        path: "gateway",
      });
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
