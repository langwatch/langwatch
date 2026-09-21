/**
 * What the gateway path's scenario cases share: the judge criteria, the key
 * the tour mints, and the reveal-in-hand run, which the test file runs from
 * two snapshots. It lives beside the test file because a helper carrying
 * assertions belongs outside a test file, where every `expect` sits inside
 * an `it`.
 */

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { expect } from "vitest";
import {
  assertPathCompletedAfterSkill,
  attachKickoffConversation,
  expectNoSecretInText,
  expectSecretSnippetOnThisGateway,
  GUIDED_LINES,
  GUIDED_TONE_CRITERIA,
  type GuidedKickoffSnapshot,
  gatewayPublicUrl,
  listVirtualKeys,
  mintVirtualKey,
  queueGuidedKickoff,
  readGuidedState,
  saysVerbatim,
  seedGuidedOrganization,
  waitForPathDone,
} from "./guided-onboarding-fixture";
import { makeLangyAdapter } from "./langy-agent";
import { runScenarioAndLog } from "./scenario-logger";
import { allAssistantText } from "./scenario-transcript";

export const model = openai("gpt-5-mini");

export const KEY_NAME = "production-app";

export const GATEWAY_CRITERIA = [
  `Langy says, word for word: "${GUIDED_LINES.gatewayLive}"`,
  // The key's display prefix is a short vk-lw- value the product itself
  // prints, on the masked card and in the keys list, and it reaches the
  // transcript in the secret_snippet call. Only the secret is forbidden, so
  // the criterion has to say which of the two it means.
  "Langy shows the environment snippet through the secret snippet card, and writes no key secret in any message. A secret is a long vk-lw- value, around thirty characters; the key's short display prefix is not one, and neither is a reveal id.",
  `Langy ends with, word for word: "${GUIDED_LINES.gatewayClose}"`,
  // The two lines above are required word for word, and the first of them
  // tells the user to point their app at the gateway. Without the carve-out
  // the judge is handed two criteria that cannot both hold, and which one
  // wins is a coin flip.
  "Langy asks the user no question and hands over no step of its own; the closing line's offer to help is the copy, not a question, and a line Langy is required to say word for word does not count, whatever it tells the user to do.",
  ...GUIDED_TONE_CRITERIA,
];

/** The index of the first command matching, or -1. */
export function firstCommand(commands: string[], pattern: RegExp): number {
  return commands.findIndex((command) => pattern.test(command));
}

/**
 * The reveal-in-hand case, run from either snapshot: the suite's own, read
 * after the key was minted, or the panel's, composed before the tour recorded
 * it. The second is the live run; the server settles it from the stored state
 * and the model has to read the settled brief, not the snapshot.
 */
export async function expectGatewayPathFromTheRevealInHand({
  label,
  name,
  description,
  snapshot,
}: {
  label: string;
  name: string;
  description: string;
  snapshot: GuidedKickoffSnapshot;
}): Promise<void> {
  const org = await seedGuidedOrganization({
    label,
    paths: ["gateway"],
    tour: "completed",
  });
  await mintVirtualKey({
    organizationId: org.organizationId,
    projectId: org.projectId,
    name: KEY_NAME,
  });

  const langy = makeLangyAdapter();
  await queueGuidedKickoff({
    adapter: langy,
    org,
    path: "gateway",
    tourStatus: "completed",
    snapshot,
  });

  const result = await runScenarioAndLog({
    config: {
      name,
      description: `Someone who just signed up picked Gateway. The tour already created a virtual key named production-app. The app sends Langy the guided onboarding kickoff${description}; nothing was typed by the person.`,
      agents: [
        langy,
        scenario.userSimulatorAgent({ model }),
        scenario.judgeAgent({
          model,
          criteria: [
            "Langy does not create a second virtual key: the production-app key already exists and Langy says nothing about it having existed.",
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
  // The brief carries the reveal id, so the key and its secret are both
  // in hand: there is nothing to look up and nothing to mint.
  expect(firstCommand(commands, /virtual-keys list/)).toBe(-1);
  expect(firstCommand(commands, /virtual-keys create/)).toBe(-1);

  const keys = await listVirtualKeys(org.organizationId);
  console.log("[layer2] keys:", keys.map((key) => key.name).join(", "));
  expect(keys.filter((key) => key.name === KEY_NAME)).toHaveLength(1);

  const text = allAssistantText(result);
  // The tour minted the key, so the first thing Langy says is that it is
  // live: nothing about the key already existing comes before it.
  const firstLine =
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? "";
  expect(saysVerbatim(firstLine, GUIDED_LINES.gatewayLive)).toBe(true);
  expect(text).not.toMatch(
    /already (exists?|have|had|minted|created|set up|there)/i,
  );
  // The brief named the key by its reveal id, and the card reads that
  // one: the secret never crosses a message.
  const { virtualKeyRevealId } = await readGuidedState(org.organizationId);
  expect(virtualKeyRevealId).toMatch(/^rvl_/);
  expectSecretSnippetOnThisGateway({
    events: langy.state.toolEvents,
    gatewayUrl: await gatewayPublicUrl(),
    revealId: virtualKeyRevealId,
  });
  expectNoSecretInText(text);
  expect(saysVerbatim(text, GUIDED_LINES.gatewayClose)).toBe(true);
  expect(
    commands.some((command) =>
      /langwatch onboarding complete-path gateway/.test(command),
    ),
  ).toBe(true);
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
}
