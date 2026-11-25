/**
 * The llmops path in a folder that is not a git repository. See README.md
 * "Scenario notes" (llmops-no-repo) for what it covers and why, and the
 * "Run" section above for how to run one file.
 */

import path from "node:path";

import * as scenario from "@langwatch/scenario";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  attachKickoffConversation,
  conversationMessages,
  GUIDED_LINES,
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
import { runScenarioAndLog } from "./scenario-logger";

const model = guidedHarnessModel();

/** The budget of a run that installs an SDK, edits code and starts the agent. */
const LONG_RUN_TIMEOUT_MS = 2_700_000;

/** The unlock question, word for word from the guided onboarding skill. */
const REPO_QUESTION =
  "This folder isn't a git repository yet, so I can't make a branch for the tracing change. Want me to create one?";
const CREATE_REPO_OPTION = "Create a repository for me";
const ANOTHER_FOLDER_OPTION = "I'll choose another folder";

let org: GuidedOrganization;
let folder: FixtureFolder;
let python: PythonEnv;
let terminal: CliTerminal | undefined;
let watcher: ConversationWatcher | undefined;

// The answer is acted on in the next turn, so the run waits for it before
// judging the path. Not always a next turn, though: an answer that reaches
// the card while its call is still open is returned into the turn that
// asked, and that turn carries on and does the work itself.
async function relayNoRepoAnswerAftermath({
  executor,
  seenTurns,
  askedIn,
}: {
  executor: scenario.ScenarioExecutionLike;
  seenTurns: string[];
  askedIn: string;
}): Promise<void> {
  if (askedIn && (await watcher!.cardAnsweredInsideTurn({ turnId: askedIn }))) {
    return;
  }
  const nextTurnId = await watcher!.waitForNewTurn({ knownTurnIds: seenTurns });
  seenTurns.push(nextTurnId);
  await watcher!.waitForIdle(LONG_RUN_TIMEOUT_MS);
  for (const message of await watcher!.lastTurnMessages({ turnId: nextTurnId })) {
    await executor.message(message as never);
  }
  for (const note of watcher!.drainAnswerNotes()) {
    await executor.message({ role: "user", content: note });
  }
}

describe("Langy asks before making a repository in a folder that has none", () => {
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
      name: "guided-no-repo",
      git: false,
    });
    if (folder.isGitRepo()) {
      throw new Error("the fixture folder was created with a repository in it");
    }
    python = await createPythonEnv({
      at: path.join(folder.root, "..", "guided-no-repo-python"),
      forFolder: folder.root,
    });
  }, 1_200_000);

  afterAll(async () => {
    await teardown({ terminal, watcher, repo: folder });
  });

  describe("when the shared folder has no repository in it", () => {
    /** @scenario A folder with no repository is asked about, not branched in */
    it(
      "ends the turn on the unlock card, then creates the repository and carries on",
      async () => {
        const langy = makeLangyAdapter();
        /** Whether a repository existed at the moment the card was answered. */
        let repoAtQuestion: boolean | null = null;
        watcher = watchLangyConversation({
          adapter: langy,
          policy: { fallback: "allow_once" },
          answerQuestion: async (question) => {
            const labels = question.options?.map((option) => option.label) ?? [];
            if (labels.includes(CREATE_REPO_OPTION)) {
              repoAtQuestion = folder.isGitRepo();
              return [CREATE_REPO_OPTION];
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
            name: "guided onboarding: the llmops path in a folder that is not a repository",
            description:
              "A developer of the ACME notes application (one OpenAI call behind a FastAPI endpoint, no tracing and no tests) just signed up and picked Evals & LLM Ops. The folder they share through the command line has no git repository in it at all, so no branch and no commit can be made there. Langy must ask before creating one, and carry on once the developer says go.",
            agents: [
              langy,
              scenario.userSimulatorAgent({ model }),
              scenario.judgeAgent({
                model,
                criteria: [
                  `When the folder is not a git repository, Langy asks about it with a question card reading, word for word: "${REPO_QUESTION}"`,
                  `The card carries exactly two options, in this order: "${CREATE_REPO_OPTION}" and "${ANOTHER_FOLDER_OPTION}".`,
                  "Langy never reports the missing repository as a failure it stopped on, and never asks the developer to run git themselves: it offers to do it.",
                  "Nothing is branched, committed or checked out before the developer answers the card.",
                  "Once the developer picks the option that creates the repository, Langy makes it and carries on with the tracing work rather than asking again.",
                  `Because the folder it created has no remote, Langy says the no-remote line, "${GUIDED_LINES.noRemoteStart} <the branch> holds the commit.", and never claims a pull request it did not open.`,
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
                  label: "guided-no-repo",
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
              async (_state, executor) => {
                const askedIn = seenTurns[seenTurns.length - 1] ?? "";
                await relayNoRepoAnswerAftermath({ executor, seenTurns, askedIn });
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
            (question.options ?? []).some((option) => option.label === CREATE_REPO_OPTION),
          );
        console.log("[layer2] unlock card:", JSON.stringify(unlock));
        expect(unlock).toBeDefined();
        expect(unlock!.question).toBe(REPO_QUESTION);
        const labels = unlock!.options?.map((option) => option.label) ?? [];
        expect(labels).toEqual([CREATE_REPO_OPTION, ANOTHER_FOLDER_OPTION]);

        // Nothing was branched before the developer answered.
        expect(repoAtQuestion).toBe(false);
        const checkoutAt = commands.findIndex((command) => /git\s+checkout\s+-b/.test(command));
        const initAt = commands.findIndex((command) => /git\s+init/.test(command));
        console.log("[layer2] git init at", initAt, "checkout at", checkoutAt);
        expect(initAt).toBeGreaterThanOrEqual(0);
        expect(checkoutAt === -1 || checkoutAt > initAt).toBe(true);

        // The answer was acted on: a repository, a first commit, and the
        // langy branch the path carries on with.
        expect(folder.isGitRepo()).toBe(true);
        const log = folder.log();
        console.log("[layer2] commits:", log.join(" | "));
        expect(log.length).toBeGreaterThan(0);
        const branches = folder.branches();
        console.log("[layer2] branches:", branches.join(", "));
        expect(branches.some((branch) => branch.startsWith("langy/"))).toBe(true);
        // The first commit of a repository Langy made never carries a key.
        expect(folder.read(".gitignore")).toMatch(/\.env/);

        if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
        expect(result.success).toBe(true);
      },
      LONG_RUN_TIMEOUT_MS + 900_000,
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
