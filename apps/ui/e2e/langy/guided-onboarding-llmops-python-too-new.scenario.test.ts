/**
 * The llmops path on an interpreter the published SDK does not ship for.
 * See README.md "Scenario notes" (llmops-python-too-new) for what it covers
 * and why, and the "Run" section above for how to run one file.
 */

import path from "node:path";

import * as scenario from "@langwatch/scenario";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  attachKickoffConversation,
  conversationMessages,
  type GuidedOrganization,
  guidedHarnessModel,
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
import { belowVersion, installedVersion, reachableVersion } from "./pip-index";
import { runScenarioAndLog } from "./scenario-logger";

const model = guidedHarnessModel();

/** The budget of a run that installs an SDK, edits code and starts the agent. */
const LONG_RUN_TIMEOUT_MS = 2_700_000;

/**
 * The unlock question, word for word from the skill, with the interpreter's
 * own reported version in place of 3.14 (see README.md "Scenario notes",
 * llmops-python-too-new).
 */
const PYTHON_QUESTION =
  /^Your Python (\S+) is newer than the LangWatch SDK supports, so pip installed an old release without the tracing API\. Want me to set up a supported Python for this folder\?$/;
const INSTALL_PYTHON_OPTION = "Install Python 3.13 with uv for me";
const OWN_INTERPRETER_OPTION = "I'll pick the interpreter myself";

/** The first release carrying the API the guided path writes against. */
const FIRST_SUPPORTED_SDK = "1.3.0";

/** The file the path edits, as the fixture ships it. */
const PRISTINE_MAIN = "app/main.py";

let org: GuidedOrganization;
let folder: FixtureFolder;
let python: PythonEnv;
let pristineMain: string;
let terminal: CliTerminal | undefined;
let watcher: ConversationWatcher | undefined;

describe("Langy asks for a supported Python before writing against an SDK that lacks the API", () => {
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
      name: "guided-python-too-new",
      git: true,
    });
    python = await createPythonEnv({
      at: path.join(folder.root, "..", "guided-python-too-new-python"),
      forFolder: folder.root,
      interpreter: "machine-default",
    });
    // The premise is not the version number, it is what pip can reach on it.
    // Once a release ships that this interpreter accepts, pip installs the
    // current SDK, the check passes and there is no card: the scenario would
    // go green while testing nothing. Ask the index rather than assume.
    const reachable = reachableVersion({
      python: python.python,
      name: "langwatch",
    });
    if (!reachable || !belowVersion(reachable, FIRST_SUPPORTED_SDK)) {
      throw new Error(
        `this scenario needs an interpreter pip cannot reach a current SDK on, and python ${python.version} here reaches ${reachable ?? "nothing"}; the published range now covers it, so retire this scenario or pin the interpreter it takes away`,
      );
    }
    pristineMain = folder.read(PRISTINE_MAIN);
  }, 1_200_000);

  afterAll(async () => {
    await teardown({ terminal, watcher, repo: folder });
  });

  describe("when pip can only reach a release without the tracing API", () => {
    /** @scenario An interpreter the SDK does not ship for is asked about, not written against */
    it(
      "ends the turn on the interpreter card with the code still untouched",
      async () => {
        const langy = makeLangyAdapter();
        /** What `app/main.py` held at the moment the card was answered. */
        let mainAtQuestion: string | null = null;
        watcher = watchLangyConversation({
          adapter: langy,
          policy: { fallback: "allow_once" },
          answerQuestion: async (question) => {
            const labels = question.options?.map((option) => option.label) ?? [];
            if (labels.includes(INSTALL_PYTHON_OPTION)) {
              mainAtQuestion = folder.read(PRISTINE_MAIN);
              return [INSTALL_PYTHON_OPTION];
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
            name: "guided onboarding: the llmops path on a python the SDK does not ship for",
            description:
              "A developer of the ACME notes application (one OpenAI call behind a FastAPI endpoint, a requirements.txt manifest, no tracing and no tests) just signed up and picked Evals & LLM Ops. The folder is shared through the command line. The only interpreter on the terminal's PATH is Python 3.14, which every current LangWatch release excludes, so `pip install langwatch` silently resolves to 0.1.32: a release with no `setup()` and no `connect_agent()`. Langy must notice before it writes any code, and offer to set up an interpreter that works.",
            agents: [
              langy,
              scenario.userSimulatorAgent({ model }),
              scenario.judgeAgent({
                model,
                criteria: [
                  `After installing the package, before editing any file, Langy checks through the interpreter that the installed release carries the tracing API (an import of langwatch naming setup and connect_agent, or the installed version).`,
                  `When that check fails, Langy asks with a question card reading, word for word, with the interpreter's own version in place of <version>: "Your Python <version> is newer than the LangWatch SDK supports, so pip installed an old release without the tracing API. Want me to set up a supported Python for this folder?"`,
                  `The card carries exactly two options, in this order: "${INSTALL_PYTHON_OPTION}" and "${OWN_INTERPRETER_OPTION}".`,
                  "Langy never runs `pip install langwatch --upgrade` against this interpreter. The newest release it can reach is already installed, so an upgrade cannot change the outcome.",
                  'Langy never edits the project\'s code while the interpreter in use lacks the API, and never reports the missing API as a failure it stopped on: it offers the interpreter instead. What completes the switch is a check through the NEW interpreter that exits clean (`.venv/bin/python -c "import langwatch; langwatch.setup; langwatch.connect_agent"` or the equivalent). Edits that come after that check are the path doing its job, not a violation: judge the order against the check, not against the card.',
                  "Langy does not tell the developer to install a Python themselves, and does not call the folder broken or unsupported. Only the interpreter is too new.",
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
                  label: "guided-python-too-new",
                  clearOpenRequests: false,
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

        // The card, as the skill words it.
        const unlock = watcher.questions
          .flatMap((ask) => ask.questions)
          .find((question) =>
            (question.options ?? []).some((option) => option.label === INSTALL_PYTHON_OPTION),
          );
        console.log("[layer2] unlock card:", JSON.stringify(unlock));
        expect(unlock).toBeDefined();
        const asked = PYTHON_QUESTION.exec(unlock!.question ?? "");
        expect(asked, "the card asks the skill's question, word for word").not.toBeNull();
        // The number in it is this interpreter's, not a version recited.
        expect(asked![1]).toMatch(new RegExp(`^${python.version}(\\.|$)`));
        const labels = unlock!.options?.map((option) => option.label) ?? [];
        expect(labels).toEqual([INSTALL_PYTHON_OPTION, OWN_INTERPRETER_OPTION]);

        // The code was still untouched when the card was answered. The file
        // itself is the fact, not the order of the tool calls around it.
        console.log("[layer2] main.py unchanged at the card:", mainAtQuestion === pristineMain);
        expect(mainAtQuestion).toBe(pristineMain);

        // The install happened, and the interpreter really did get a release
        // without the API: the card is answering the machine, not a guess.
        const installed = installedVersion({
          python: python.python,
          name: "langwatch",
        });
        console.log("[layer2] installed langwatch:", installed ?? "none");
        expect(installed).not.toBeNull();
        expect(belowVersion(installed!, FIRST_SUPPORTED_SDK)).toBe(true);

        // An upgrade cannot reach past the interpreter's ceiling, so the rule
        // is that it is never tried.
        const upgrades = commands.filter((command) =>
          /pip\s+install\s+.*langwatch.*--upgrade|pip\s+install\s+--upgrade\s+.*langwatch/.test(
            command,
          ),
        );
        console.log("[layer2] upgrade attempts:", upgrades.join(" | "));
        expect(upgrades).toEqual([]);

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
