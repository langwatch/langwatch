/**
 * The llmops path in a folder whose Python install ladder has a rung
 * missing. See README.md "Scenario notes" (llmops-pip-missing) for what it
 * covers and why, and the "Run" section above for how to run one file.
 */

import path from "node:path";

import * as scenario from "@langwatch/scenario";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  attachKickoffConversation,
  conversationMessages,
  createFirstScenarioLabel,
  type GuidedOrganization,
  guidedHarnessModel,
  isProposalQuestion,
  queueGuidedKickoff,
  seedGuidedOrganization,
} from "./guided-onboarding-fixture";
import { makeLangyAdapter } from "./langy-agent";
import { LANGY_GUIDED_PATH_CRITERIA } from "./langy-rules";
import {
  assertToolsPresent,
  type CliTerminal,
  type ConversationWatcher,
  createFixtureFolder,
  createPythonEnv,
  type FixtureFolder,
  type PythonEnv,
  setCodeAccessPreference,
  startShareControl,
  teardown,
  terminalSection,
  waitForConnectedWorkspace,
  waitForPendingRequest,
  watchLangyConversation,
} from "./local-control-fixture";
import { runScenarioAndLog } from "./scenario-logger";

const model = guidedHarnessModel();

/** The budget of a run that installs an SDK, edits code and starts the agent. */
const LONG_RUN_TIMEOUT_MS = 2_700_000;

/**
 * What the missing spelling answers. Both halves matter: the text is what a
 * shell prints for a command it cannot find, and 127 is the exit code the
 * ladder reads.
 */
const PIP_NOT_FOUND = 'echo "pip: command not found" >&2\nexit 127';

let org: GuidedOrganization;
let folder: FixtureFolder;
let python: PythonEnv;
let terminal: CliTerminal | undefined;
let watcher: ConversationWatcher | undefined;

describe("Langy installs the package when pip is not on PATH", () => {
  beforeAll(async () => {
    assertToolsPresent();
    org = await seedGuidedOrganization({
      label: "LLM Ops",
      paths: ["llmops"],
      tour: "completed",
    });
    await setCodeAccessPreference(null);
    folder = await createFixtureFolder({
      fixture: "acme-notes",
      name: "guided-pip-missing",
      git: true,
    });
    python = await createPythonEnv({
      at: path.join(folder.root, "..", "guided-pip-missing-python"),
      forFolder: folder.root,
    });
  }, 1_200_000);

  afterAll(async () => {
    await teardown({ terminal, watcher, repo: folder });
  });

  describe("when the folder's own package manager spelling is gone", () => {
    /** @scenario A command not found moves the install ladder to the next rung */
    it(
      "tries the next spelling instead of retrying pip or calling the folder unmanaged",
      async () => {
        const langy = makeLangyAdapter();
        watcher = watchLangyConversation({
          adapter: langy,
          policy: { fallback: "allow_once" },
          answerQuestion: async (question) => {
            if (isProposalQuestion(question)) {
              return [createFirstScenarioLabel(question)!];
            }
            return question.options?.[0]?.label ? [question.options[0].label] : [];
          },
        });
        await queueGuidedKickoff({
          adapter: langy,
          org,
          path: "llmops",
          tourStatus: "completed",
        });

        const seenTurns: string[] = [];
        let autoTurnText = "";

        const result = await runScenarioAndLog({
          config: {
            name: "guided onboarding: the llmops path when pip is not on PATH",
            description:
              'A developer of the ACME notes application (one OpenAI call behind a FastAPI endpoint, a requirements.txt manifest, no lock file, no virtual environment, no tracing and no tests) just signed up and picked Evals & LLM Ops. The folder is shared through the command line. The terminal\'s PATH has no `pip`: that spelling answers "pip: command not found" and exits 127, while `pip3` and `python3 -m pip` work. Langy must install the LangWatch package anyway, through the next spelling on the ladder.',
            agents: [
              langy,
              scenario.userSimulatorAgent({ model }),
              scenario.judgeAgent({
                model,
                criteria: [
                  "After a command answers that it is not found, Langy tries a different spelling of the same tool before it reports anything to the developer. Retrying the spelling that was not found, or stopping at it, fails this criterion.",
                  "Langy installs the LangWatch package into the project and says so. A reply that leaves the package uninstalled fails this criterion.",
                  "Langy never tells the developer that the folder has no package manager, that Python is missing, or that they need to install a package manager themselves. Only the spelling `pip` was absent.",
                  "Langy does not ask the developer to run the install by hand while the folder is connected; it does the work itself.",
                  ...LANGY_GUIDED_PATH_CRITERIA,
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
                  label: "guided-pip-missing",
                  clearOpenRequests: false,
                  shims: { pip: PIP_NOT_FOUND },
                  pathDirs: [python.binDir],
                });
                await terminal.approve();
                const conversationId = langy.state.conversationId ?? "";
                await waitForConnectedWorkspace({ conversationId });
                const autoTurnId = await watcher!.waitForNewTurn({
                  knownTurnIds: seenTurns,
                });
                seenTurns.push(autoTurnId);
                await watcher!.waitForIdle(LONG_RUN_TIMEOUT_MS);
                autoTurnText = await watcher!.lastAssistantText({
                  turnId: autoTurnId,
                });
                for (const message of await watcher!.lastTurnMessages({
                  turnId: autoTurnId,
                })) {
                  await executor.message(message as never);
                }
                for (const note of watcher!.drainAnswerNotes()) {
                  await executor.message({ role: "user", content: note });
                }
              },
              scenario.judge(),
            ],
          },
        });

        const stored = await conversationMessages(langy.state.conversationId ?? "");
        const commands = langy.state.toolCommands.concat(storedCommands(stored));
        console.log("[layer2] commands:", commands.join(" | "));
        console.log(terminalSection(terminal!));

        // The rung that is gone was tried once at most, and the ladder moved
        // on rather than retrying a spelling that is not there. Only the bare
        // spelling counts: `python3 -m pip install` is a later rung that
        // happens to carry the same word.
        const pipAttempts = commands.filter(
          (command) =>
            /(?:^|[\s;&|])pip\s+install\b/.test(command) && !/-m\s+pip\s+install\b/.test(command),
        );
        console.log("[layer2] pip attempts:", pipAttempts.join(" | "));
        expect(pipAttempts.length).toBeLessThanOrEqual(1);
        expect(
          commands.some((command) =>
            /(pip3\s+install|python3?\s+-m\s+pip\s+install|uv\s+add)/.test(command),
          ),
        ).toBe(true);

        // Item 1 is done: the manifest names the package and the interpreter
        // the terminal used can import it.
        const manifest = folder.read("requirements.txt");
        console.log("[layer2] requirements.txt:", JSON.stringify(manifest));
        expect(manifest).toMatch(/langwatch/i);
        expect(python.canImport("langwatch")).toBe(true);

        // One rung was missing, not the whole ladder, so the unlock question
        // that offers to install uv has no business being asked.
        const asked = watcher.questions
          .flatMap((ask) => ask.questions)
          .map((question) => question.question ?? "");
        console.log("[layer2] questions:", asked.join(" | "));
        expect(asked.some((question) => /couldn't find pip or uv/i.test(question))).toBe(false);
        expect(autoTurnText).not.toMatch(/no package manager/i);

        if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
        expect(result.success).toBe(true);
      },
      LONG_RUN_TIMEOUT_MS + 600_000,
    );
  });
});

/** Every command the stored conversation shows Langy ran, in order. */
function storedCommands(messages: { parts: Record<string, unknown>[] }[]): string[] {
  return messages.flatMap((message) =>
    message.parts
      .filter(
        (part) =>
          typeof part.type === "string" &&
          part.type.startsWith("tool-") &&
          typeof (part.input as { command?: unknown } | undefined)?.command === "string",
      )
      .map((part) => String((part.input as { command: string }).command)),
  );
}
