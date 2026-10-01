/**
 * The llmops path of the guided onboarding, the way it is meant to go. See
 * README.md "Scenario notes" (llmops-share-folder) for what it covers and
 * why, and the "Run" section above for how to run one file.
 */

import * as scenario from "@langwatch/scenario";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assertPathCompletedAfterSkill,
  attachKickoffConversation,
  CREATE_FIRST_SCENARIO_OPTION,
  carriesProposalText,
  conversationMessages,
  createFirstScenarioLabel,
  createGuidedCheckout,
  expectAgentOnlineBeforeFirstRun,
  expectInstrumentationLeavesRepoWorking,
  expectSaidLinesMatchRepo,
  GUIDED_LINES,
  GUIDED_OPTIONS,
  GUIDED_TONE_CRITERIA,
  type GuidedOrganization,
  guidedHarnessModel,
  isProposalQuestion,
  listProjectScenarios,
  listProjectSuites,
  mergeToolEvents,
  queueGuidedKickoff,
  saysVerbatim,
  seedGuidedOrganization,
  storedSaidLines,
  waitForPathDone,
} from "./guided-onboarding-fixture";
import { makeLangyAdapter } from "./langy-agent";
import { LANGY_GUIDED_PATH_CRITERIA } from "./langy-rules";
import {
  assertToolsPresent,
  type CliTerminal,
  type ConversationWatcher,
  type DemoRepo,
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

/** The budget of a run that installs an SDK, edits code, starts the agent, and runs a suite. */
const LONG_RUN_TIMEOUT_MS = 2_700_000;

let org: GuidedOrganization;
let repo: DemoRepo;
let terminal: CliTerminal | undefined;
let watcher: ConversationWatcher | undefined;

describe("Langy sets up the llmops path through the shared folder", () => {
  beforeAll(async () => {
    assertToolsPresent();
    org = await seedGuidedOrganization({
      label: "LLM Ops",
      paths: ["llmops"],
      tour: "completed",
    });
    // The remembered choice is per user and outlives a run, so a leftover
    // "GitHub" from another suite would silence the very card this file is
    // about.
    await setCodeAccessPreference(null);
    repo = await createGuidedCheckout({ name: "guided-llmops" });
  }, 1_200_000);

  afterAll(async () => {
    await teardown({ terminal, watcher, repo });
  });

  describe("when the kickoff arrives and the developer shares the checkout folder", () => {
    /** @scenario The llmops path asks for code access first */
    /** @scenario A typed message mid-setup keeps the tone */
    /** @scenario Sharing the folder leads to a proposal, not a creation */
    /** @scenario Going ahead creates the scenario in the drawer beside the panel */
    /** @scenario The first run proves testing and tracing, then the suite follows */
    /** @scenario Every path ends by recording its completion */
    it(
      "asks first, proposes before creating, opens the draft beside the panel, runs, builds the suite and records the path",
      async () => {
        const langy = makeLangyAdapter();
        /** The scenario list read while the proposal was still open. */
        let scenariosAtProposal: { id: string; name: string }[] | null = null;
        watcher = watchLangyConversation({
          adapter: langy,
          policy: { fallback: "allow_once" },
          answerQuestion: async (question) => {
            if (isProposalQuestion(question)) {
              scenariosAtProposal = await listProjectScenarios();
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
        let openerText = "";

        const result = await runScenarioAndLog({
          config: {
            name: "guided onboarding: the llmops path through the shared folder",
            description:
              "A developer of the ACME checkout agent (LangGraph, no tracing, no tests) just signed up and picked Evals & LLM Ops. The app sends Langy the guided onboarding kickoff; nothing was typed by the person at first. Langy must ask for the code before anything else, keep its tone when the developer types a side question, and once the folder is shared: instrument tracing and the connect call, start the agent, PROPOSE the first scenario with a question and create it only after the developer says go, run it, add a suite, run it, open the run, record the path and close.",
            agents: [
              langy,
              scenario.userSimulatorAgent({ model }),
              scenario.judgeAgent({
                model,
                criteria: [
                  `Langy opens with, word for word: "${GUIDED_LINES.llmopsOpener}"`,
                  "Langy asks for code access through the code access card in its first step; the opener line and the card in that same step are the expected shape. Fail only if Langy writes more text or takes another action after the card and before the user answers it.",
                  "When the developer types an unrelated question while the card is up, Langy answers in one warm line that keeps the setup going and never drops the path it was on.",
                  "After the folder connects, Langy reads the code, reports the framework it found, and wires tracing and the connect call into the developer's own code.",
                  `Before proposing the first scenario, Langy says one of three lines: "${GUIDED_LINES.pullRequestOpened} <the address the command printed>. ${GUIDED_LINES.pullRequestMerge}" with a real address; or, when the folder has no remote or GitHub is not signed in, "${GUIDED_LINES.noRemoteStart} <the branch> holds the commit."; or, when the push worked and opening the pull request failed with nothing to fix ("none of the git remotes configured for this repository point to a known GitHub host", which the skill says is said at once and gets no retry) or failed again after one fix and one retry, "The branch <the branch> ${GUIDED_LINES.pushedOpenFailed} <the line the command printed>." Whichever it is, it never leaves the pull request to the end of the path.`,
                  "Every line Langy says about its branch, commit or pull request names a thing a command made: the branch line names the branch it checked out, and the pull request line carries the address the command printed or is replaced by the no-remote line. A line naming a branch, a commit or a pull request that no command made fails this criterion.",
                  "Before the first scenario runs, Langy starts the agent and confirms it is online with one langwatch agent list --wait-online call; no scenario or suite runs against an agent that did not report online.",
                  "Langy installs the langwatch package through the project's own package manager (uv add, pip install, npm install or pnpm add) before it starts the agent, so the agent process finds the module at import. An agent started before the install, or a start that dies on a missing langwatch module with no install and restart after it, fails this criterion.",
                  "The connect adapter Langy writes is the SDK's own connect call, the connect_agent decorator in Python or connectAgent in TypeScript, in the file that starts the service. A route of Langy's own answering on a path such as /langwatch/connect registers nothing with the platform, so writing one while the SDK is installed fails this criterion.",
                  "The connect call goes on a new function that wraps the entry point the repository already has and returns its reply text. Functions the repository already has keep their signature and their return value, since other files call them, and the agent is declared once: one connect call, one decorated function. Decorating an existing function in place and changing what it returns, or decorating both it and a wrapper around it, fails this criterion.",
                  "Langy says the no-remote line only when the commands showed that cause. A push that printed a new branch on a remote means the folder has one, so a pull request that fails after it is reported with the failed-open line, which names the branch and the line the command printed, and the no-remote line is wrong there. The three lines are alternatives: exactly one of them is said.",
                  "Langy never prints an environment file to the terminal: no command that shows the values in a .env file. Reading the key names alone, such as sed 's/=.*//' .env, is fine, and so is writing the file through the env tool.",
                  `Langy proposes the first scenario as one bare question card: the card's own text is the proposal, word for word from "${GUIDED_LINES.proposalStart}" up to the reason, shown as a paragraph above exactly two options, one reading Create "<the scenario title>" as your first scenario test and the quiet "${GUIDED_OPTIONS.chatAboutThis}". The framework line, the pull request sentence and the branch line arrive as Langy's own lines right before that card, in that order, and nothing is said between the branch line and the card. It creates nothing before the developer picks the create option, and once the developer picks it, its next action is creating the scenario, with no sentence first and none of the step 2 lines said again.`,
                  `After the go, Langy says, word for word: "${GUIDED_LINES.whyScenario}"`,
                  `Langy says, word for word: "${GUIDED_LINES.running}"`,
                  `After the first run, Langy says, word for word: "${GUIDED_LINES.proved}"`,
                  `Langy closes with, word for word: "${GUIDED_LINES.allReady}"`,
                  "While the folder is connected Langy never hands the user a command to run by hand; it does the work itself.",
                  ...GUIDED_TONE_CRITERIA,
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
                // The card comes from the tool, so a missing tool call is a
                // clearer failure than a request that never appears.
                expect(langy.state.toolNames).toContain("code_access");
                await waitForPendingRequest({ conversationId });
                openerText = await watcher!.lastAssistantText({
                  turnId: langy.state.currentTurnId ?? undefined,
                });
                seenTurns.push(...watcher!.turnIds);
                if (langy.state.currentTurnId) {
                  seenTurns.push(langy.state.currentTurnId);
                }
                for (const note of watcher!.drainAnswerNotes()) {
                  await executor.message({ role: "user", content: note });
                }
              },
              // A question typed while the card waits: the setup must not
              // lose its thread.
              scenario.user(
                "Quick one before we go on: does LangWatch work with Anthropic models too, or only OpenAI?",
              ),
              scenario.agent(),
              async () => {
                seenTurns.push(...watcher!.turnIds);
                if (langy.state.currentTurnId) {
                  seenTurns.push(langy.state.currentTurnId);
                }
              },
              // The developer picks the local folder: approving in the
              // terminal is the whole of that choice.
              async (_state, executor) => {
                terminal = await startShareControl({
                  repo,
                  label: "guided-llmops",
                  // This conversation asked for the folder before the terminal started.
                  clearOpenRequests: false,
                });
                await terminal.approve();
                const conversationId = langy.state.conversationId ?? "";
                await waitForConnectedWorkspace({ conversationId });
                // The connection starts the next turn on its own. The
                // scenario has to see that turn, or the judge grades a
                // conversation that stopped at the card.
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

        // Layer 2: the card asked first, with the describe way out.
        const stored = await conversationMessages(langy.state.conversationId ?? "");
        const codeAccessCalls = stored.flatMap((message) =>
          message.parts.filter((part) => part.type === "tool-code_access"),
        );
        console.log(
          "[layer2] code_access inputs:",
          JSON.stringify(codeAccessCalls.map((call) => call.input)),
        );
        expect(codeAccessCalls.length).toBeGreaterThan(0);
        expect((codeAccessCalls[0]?.input as { offer_describe?: unknown })?.offer_describe).toBe(
          true,
        );
        expect(saysVerbatim(openerText, GUIDED_LINES.llmopsOpener)).toBe(true);

        // Layer 2: the folder, as git sees it.
        const branches = repo.branches();
        const langyBranches = branches.filter((branch) => branch.startsWith("langy/"));
        console.log("[layer2] branches:", branches.join(", "));
        console.log("[layer2] commits:", repo.log().join(" | "));
        console.log(
          "[layer2] permission asks:",
          watcher.permissions.map((ask) => ask.summary).join(" | "),
        );
        console.log(terminalSection(terminal!));
        expect(langyBranches.length).toBeGreaterThan(0);
        const branch = langyBranches[0] as string;
        const diff = repo.diffAgainstMain(branch);
        expect(diff).toMatch(/langwatch/i);
        expect(diff).toMatch(/pyproject\.toml/);
        expect(diff).toMatch(/connect|serve\(/i);
        expect(repo.log().length).toBeGreaterThan(1);
        // Layer 2: the lines Langy said name the branch, the commit and the
        // pull request the commands made, and the agent was online before
        // the first run.
        const said = storedSaidLines(stored);
        console.log("[layer2] said:", said.join(" | "));
        expectSaidLinesMatchRepo({ lines: said, repo, messages: stored });
        expectAgentOnlineBeforeFirstRun(stored);
        await expectInstrumentationLeavesRepoWorking({ repo, branch });

        // Layer 2: the proposal came as a question with the quiet way out,
        // and nothing existed while it was open.
        const proposal = watcher.questions
          .flatMap((ask) => ask.questions)
          .find((question) => isProposalQuestion(question));
        console.log("[layer2] proposal:", JSON.stringify(proposal));
        expect(proposal).toBeDefined();
        // The card carries the proposal as its own text, drawn as prose, and
        // the options under it.
        expect((proposal as { bare?: boolean }).bare).toBe(true);
        expect(carriesProposalText(proposal!)).toBe(true);
        const labels = proposal!.options?.map((option) => option.label) ?? [];
        expect(labels).toHaveLength(2);
        expect(labels[0]).toMatch(CREATE_FIRST_SCENARIO_OPTION);
        expect(labels[1]).toBe(GUIDED_OPTIONS.chatAboutThis);
        expect(proposal!.options?.[1]?.quiet).toBe(true);
        expect(proposal!.options?.[0]?.quiet).not.toBe(true);
        expect(scenariosAtProposal).toEqual([]);

        // Layer 2: the project holds the scenario, the suite, and the runs
        // were opened beside the panel.
        const scenarios = await listProjectScenarios();
        const suites = await listProjectSuites();
        const commands = langy.state.toolCommands.concat(storedCommands(stored));
        console.log("[layer2] scenarios:", scenarios.map((s) => s.name).join(" | "));
        console.log("[layer2] suites:", suites.map((s) => s.name).join(" | "));
        console.log("[layer2] navigate:", watcher.navigateHrefs.join(", "));
        console.log("[layer2] commands:", commands.join(" | "));
        expect(scenarios.length).toBeGreaterThanOrEqual(2);
        expect(suites.length).toBeGreaterThanOrEqual(1);
        expect(watcher.navigateHrefs.length).toBeGreaterThanOrEqual(2);
        expect(
          watcher.navigateHrefs.some((href) => scenarios.some((s) => href.includes(s.id))),
        ).toBe(true);
        expect(commands.some((c) => /scenario create/.test(c))).toBe(true);
        expect(commands.some((c) => /scenario run/.test(c))).toBe(true);
        expect(commands.some((c) => /test-suite create/.test(c))).toBe(true);
        expect(commands.some((c) => /test-suite run/.test(c))).toBe(true);
        const createAt = commands.findIndex((c) => /scenario create/.test(c));
        const proposalAt = watcher.questions.findIndex((ask) =>
          ask.questions.some((q) => isProposalQuestion(q)),
        );
        expect(proposalAt).toBeGreaterThanOrEqual(0);
        expect(createAt).toBeGreaterThanOrEqual(0);

        // The lines, verbatim, in the turn that did the work.
        expect(saysVerbatim(autoTurnText, GUIDED_LINES.whyScenario)).toBe(true);
        expect(saysVerbatim(autoTurnText, GUIDED_LINES.running)).toBe(true);
        expect(saysVerbatim(autoTurnText, GUIDED_LINES.proved)).toBe(true);
        expect(saysVerbatim(autoTurnText, GUIDED_LINES.allReady)).toBe(true);

        expect(commands.some((c) => /langwatch onboarding complete-path llmops/.test(c))).toBe(
          true,
        );
        assertPathCompletedAfterSkill({
          events: mergeToolEvents(langy.state.toolEvents, watcher.toolEvents),
          path: "llmops",
          after: [/langwatch test-suite run/],
        });
        const state = await waitForPathDone({
          organizationId: org.organizationId,
          path: "llmops",
        });
        console.log("[layer2] guided state:", JSON.stringify(state));
        expect(state.donePaths).toContain("llmops");
        expect(state.conversationId).toBe(langy.state.conversationId);

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
