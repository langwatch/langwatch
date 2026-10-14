/**
 * The llmops path in a folder with no LLM agent in it. See README.md
 * "Scenario notes" (llmops-no-agent) for what it covers and why, and the
 * "Run" section above for how to run one file.
 */

import * as path from "node:path";

import * as scenario from "@langwatch/scenario";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { browserQA, closeBrowserQA } from "./browser-qa";
import {
  attachKickoffConversation,
  conversationMessages,
  type GuidedOrganization,
  guidedHarnessModel,
  queueGuidedKickoff,
  seedGuidedOrganization,
  storedSaidLines,
} from "./guided-onboarding-fixture";
import { makeLangyAdapter } from "./langy-agent";
import {
  assertToolsPresent,
  type CliTerminal,
  type ConversationWatcher,
  createFixtureFolder,
  type FixtureFolder,
  startShareControl,
  teardown,
  terminalSection,
  waitForConnectedWorkspace,
  waitForPendingRequest,
  watchLangyConversation,
} from "./local-control-fixture";
import { runScenarioAndLog } from "./scenario-logger";

const model = guidedHarnessModel();

/** The budget of a run that reads the folder and stops on a card. */
const RUN_TIMEOUT_MS = 1_200_000;

/** The unlock question, word for word from the guided onboarding skill. */
const noAgentQuestion = (folder: string): string =>
  `I read ${folder} and found no LLM agent in it, so there is nothing for me to trace yet. Want me to write a small starter agent here to set up with?`;
const STARTER_OPTION = "Write a starter agent for me";
const ANOTHER_FOLDER_OPTION = "I'll connect another folder";
const ANOTHER_FOLDER_LINE =
  "Run the same share command in the folder that holds your agent, and send me a message once it is connected: I'll start the setup there.";
const MID_SETUP_LINE = "We'll get to that! Let me finish getting you set up first";

let org: GuidedOrganization;
let folder: FixtureFolder;
let terminal: CliTerminal | undefined;
let watcher: ConversationWatcher | undefined;

describe("Langy asks before going on in a folder with no LLM agent", () => {
  beforeAll(async () => {
    assertToolsPresent();
    org = await seedGuidedOrganization({
      label: "LLM Ops",
      paths: ["llmops"],
      tour: "completed",
    });
    folder = await createFixtureFolder({
      fixture: "acme-pocket",
      name: "guided-no-agent",
      git: true,
    });
  }, 1_200_000);

  afterAll(async () => {
    await closeBrowserQA();
    await teardown({ terminal, watcher, repo: folder });
  });

  describe("when the shared folder has no model call in it", () => {
    /** @scenario A folder with no LLM agent gets a question, never a stop */
    it(
      "ends on the no-agent card and hands the setup back for another folder",
      async () => {
        const langy = makeLangyAdapter();
        const screenshots: string[] = [];
        watcher = watchLangyConversation({
          adapter: langy,
          policy: { fallback: "allow_once" },
          answerQuestion: async (question) => {
            const labels = question.options?.map((option) => option.label) ?? [];
            if (labels.includes(ANOTHER_FOLDER_OPTION)) {
              const shot = await browserQA({
                label: "guided-no-agent-card",
                projectSlug: org.projectSlug,
                path: `?langyConversation=${langy.state.conversationId ?? ""}`,
              });
              screenshots.push(shot.screenshotPath);
              return [ANOTHER_FOLDER_OPTION];
            }
            return labels[0] ? [labels[0]] : [];
          },
        });
        await queueGuidedKickoff({
          adapter: langy,
          org,
          path: "llmops",
          tourStatus: "completed",
        });

        const seenTurns: string[] = [];

        const result = await runScenarioAndLog({
          config: {
            name: "guided onboarding: the llmops path in a folder with no LLM agent",
            description:
              "A developer just signed up and picked Evals & LLM Ops. The folder they share through the command line is a SwiftUI app and ESP32 firmware with no model call anywhere in it, so there is nothing to trace. Langy must say so in a question card and offer a starter agent or another folder, rather than stopping or promising work it is not doing.",
            agents: [
              langy,
              scenario.userSimulatorAgent({ model }),
              scenario.judgeAgent({
                model,
                criteria: [
                  "Langy reads the shared folder and says it found no LLM agent in it, in a question card that offers to write a starter agent or to connect another folder.",
                  "Langy never says the setup is not done and then stops, and never says it will finish the setup first when the developer asked nothing.",
                  "Nothing is branched, edited or installed before the developer answers the card.",
                  "Once the developer picks the other folder, Langy tells them to run the same share command in the folder that holds their agent, and ends there.",
                ],
              }),
            ],
            script: [
              scenario.agent(),
              async (_state, executor) => {
                await attachKickoffConversation({ org, adapter: langy });
                const conversationId = langy.state.conversationId ?? "";
                expect(conversationId).not.toBe("");
                await waitForPendingRequest({ conversationId });
                seenTurns.push(...watcher!.turnIds);
                if (langy.state.currentTurnId) {
                  seenTurns.push(langy.state.currentTurnId);
                }
                for (const note of watcher!.drainAnswerNotes()) {
                  await executor.message({ role: "user", content: note });
                }
              },
              async (_state, executor) => {
                terminal = await startShareControl({
                  repo: folder,
                  label: "guided-no-agent",
                  clearOpenRequests: false,
                });
                await terminal.approve();
                const conversationId = langy.state.conversationId ?? "";
                await waitForConnectedWorkspace({ conversationId });
                const autoTurnId = await watcher!.waitForNewTurn({
                  knownTurnIds: seenTurns,
                });
                seenTurns.push(autoTurnId);
                await watcher!.waitForIdle(RUN_TIMEOUT_MS);
                for (const message of await watcher!.lastTurnMessages({
                  turnId: autoTurnId,
                })) {
                  await executor.message(message as never);
                }
                for (const note of watcher!.drainAnswerNotes()) {
                  await executor.message({ role: "user", content: note });
                }
              },
              async () => {
                await watcher!.waitForIdle(RUN_TIMEOUT_MS);
              },
              scenario.judge(),
            ],
          },
        });

        const stored = await conversationMessages(langy.state.conversationId ?? "");
        const said = storedSaidLines(stored);
        console.log("[layer2] said:", said.join(" | "));
        console.log(terminalSection(terminal!));

        const after = await browserQA({
          label: "guided-no-agent-handover",
          projectSlug: org.projectSlug,
          path: `?langyConversation=${langy.state.conversationId ?? ""}`,
        });
        screenshots.push(after.screenshotPath);
        console.log("[layer2] screenshots:", screenshots.join(", "));

        // The card, as the skill words it.
        const unlock = watcher.questions
          .flatMap((ask) => ask.questions)
          .find((question) =>
            (question.options ?? []).some((option) => option.label === ANOTHER_FOLDER_OPTION),
          );
        console.log("[layer2] unlock card:", JSON.stringify(unlock));
        expect(unlock).toBeDefined();
        const named = /^I read (.+?) and found no LLM agent in it/.exec(unlock!.question);
        expect(named).not.toBeNull();
        expect(named![1]).toBe(path.basename(folder.root));
        expect(unlock!.question).toBe(noAgentQuestion(named![1]!));
        const labels = unlock!.options?.map((option) => option.label) ?? [];
        expect(labels).toEqual([STARTER_OPTION, ANOTHER_FOLDER_OPTION]);

        // No stop on "not done", no mid-setup line with nothing typed, and
        // the handover line once the developer picked another folder.
        expect(said.some((line) => line.includes(MID_SETUP_LINE))).toBe(false);
        expect(said.some((line) => /not done/i.test(line))).toBe(false);
        expect(said.some((line) => line.includes(ANOTHER_FOLDER_LINE))).toBe(true);

        // Nothing was branched or edited.
        expect(folder.branches()).toEqual(["main"]);
        expect(folder.status()).toBe("");

        if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
        expect(result.success).toBe(true);
      },
      RUN_TIMEOUT_MS + 900_000,
    );
  });
});
