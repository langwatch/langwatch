/**
 * The llmops path when every rung above `python3 -m pip` is gone.
 * See README.md "Scenario notes" (llmops-pip-gone).
 */

import { existsSync, readFileSync } from "node:fs";
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

/** The spellings this terminal will not have. */
const GONE = ["uv", "pip", "pip3"] as const;

/**
 * What a gone spelling answers: the line a shell prints for a command it
 * cannot find, and the 127 the ladder reads, with the call itself appended to
 * the log first so the run knows the rung was reached.
 */
function goneShim({ name, log }: { name: string; log: string }): string {
  return [
    `printf '%s\\n' "${name} $*" >> ${JSON.stringify(log)}`,
    `echo "${name}: command not found" >&2`,
    "exit 127",
  ].join("\n");
}

let org: GuidedOrganization;
let folder: FixtureFolder;
let python: PythonEnv;
let shimLog: string;
let terminal: CliTerminal | undefined;
let watcher: ConversationWatcher | undefined;

describe("Langy walks the install ladder down to a rung that works", () => {
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
      name: "guided-pip-gone",
      git: true,
    });
    python = await createPythonEnv({
      at: path.join(folder.root, "..", "guided-pip-gone-python"),
      forFolder: folder.root,
    });
    shimLog = path.join(folder.root, "..", "guided-pip-gone-shims.log");
  }, 1_200_000);

  afterAll(async () => {
    await teardown({ terminal, watcher, repo: folder });
  });

  describe("when uv, pip and pip3 are all missing from the terminal", () => {
    /** @scenario Every missing rung is tried once, and the ladder still installs */
    it(
      "installs through the interpreter without retrying a spelling that is gone",
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
            name: "guided onboarding: the llmops path with uv, pip and pip3 all gone",
            description:
              'A developer of the ACME notes application (one OpenAI call behind a FastAPI endpoint, a requirements.txt manifest, no lock file, no virtual environment, no tracing and no tests) just signed up and picked Evals & LLM Ops. The folder is shared through the command line. The terminal has no `uv`, no `pip` and no `pip3`: each answers "command not found" and exits 127. The interpreter on PATH works and can install through `-m pip`. Langy must install the LangWatch package through it.',
            agents: [
              langy,
              scenario.userSimulatorAgent({ model }),
              scenario.judgeAgent({
                model,
                criteria: [
                  "After a command answers that it is not found, Langy tries a different spelling of the same tool before it reports anything to the developer. Retrying the spelling that was not found, or stopping at it, fails this criterion.",
                  "Langy installs the LangWatch package into the project and says so. A reply that leaves the package uninstalled fails this criterion.",
                  "Langy never tells the developer that the folder has no package manager, that Python is missing, or that they need to install a package manager themselves. The interpreter on PATH could install the whole time.",
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
                  label: "guided-pip-gone",
                  clearOpenRequests: false,
                  shims: Object.fromEntries(
                    GONE.map((name) => [name, goneShim({ name, log: shimLog })]),
                  ),
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

        // Which rungs Langy actually reached for, from the shims themselves.
        const refused = existsSync(shimLog)
          ? readFileSync(shimLog, "utf8").split("\n").filter(Boolean)
          : [];
        console.log("[layer2] rungs refused:", refused.join(" | "));

        // A spelling that answered 127 was not asked again. The count is per
        // spelling, so an install tried through one of them stays one attempt
        // whatever the ladder did with the others.
        for (const name of GONE) {
          const attempts = refused.filter((call) =>
            new RegExp(`^${name} (install|add)\\b`).test(call),
          );
          console.log(`[layer2] ${name} attempts:`, attempts.length);
          expect(attempts.length).toBeLessThanOrEqual(1);
        }

        // Item 1 is done through the rung that was there: the manifest names
        // the package and the interpreter the terminal used can import it.
        expect(commands.some((command) => /python3?\s+-m\s+pip\s+install/.test(command))).toBe(
          true,
        );
        const manifest = folder.read("requirements.txt");
        console.log("[layer2] requirements.txt:", JSON.stringify(manifest));
        expect(manifest).toMatch(/langwatch/i);
        expect(python.canImport("langwatch")).toBe(true);

        // The ladder had a rung left, so the question that offers to install uv
        // has no business being asked.
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
