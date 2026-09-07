/**
 * The llmops path when the developer wants to talk first, and the first
 * scenario then fails: on the proposal the developer picks the quiet "Chat
 * about this", Langy hands the scenario back to the conversation and ends
 * the turn; the developer asks for a scenario the checkout agent cannot pass
 * (an expired discount code that must be honoured), Langy writes and runs
 * it, explains the failure in plain words, keeps going with the suite,
 * points at the run, and still records the path as done.
 *
 * Layer 2 is the question card and the empty scenario list while it was
 * open, the turn that ended on the chat line with nothing created, the
 * failed run and the suite on the project, and the guided state.
 *
 * RUN (one file per vitest run, see README):
 *   cd platform/app/e2e/langy && npx vitest run guided-onboarding-llmops-chat-and-failure.scenario.test.ts --reporter=verbose
 */

import * as scenario from "@langwatch/scenario";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertPathCompletedAfterSkill,
  attachKickoffConversation,
  carriesProposalText,
  conversationMessages,
  createGuidedCheckout,
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
  waitForPathDone,
} from "./guided-onboarding-fixture";
import { makeLangyAdapter } from "./langy-agent";
import { LANGY_CORE_RULE_CRITERIA } from "./langy-rules";
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

const LONG_RUN_TIMEOUT_MS = 2_700_000;

/** A scenario the checkout agent is built to fail: SPRING25 is expired. */
const IMPOSSIBLE_SCENARIO =
  "Let's start with a discount one: a guest applies the code SPRING25 at checkout and the scenario passes only if the agent accepts it and takes 25% off the total.";

let org: GuidedOrganization;
let repo: DemoRepo;
let terminal: CliTerminal | undefined;
let watcher: ConversationWatcher | undefined;

describe("Langy talks the scenario through first, and a failing run keeps the suite", () => {
  beforeAll(async () => {
    assertToolsPresent();
    org = await seedGuidedOrganization({
      label: "LLM Ops chat",
      paths: ["llmops"],
      tour: "completed",
    });
    await setCodeAccessPreference(null);
    repo = await createGuidedCheckout({ name: "guided-chat" });
  }, 1_200_000);

  afterAll(async () => {
    await teardown({ terminal, watcher, repo });
  });

  describe("when the developer picks Chat about this and asks for a scenario the agent cannot pass", () => {
    /** @scenario Chat about this hands the scenario back to the conversation */
    /** @scenario A scenario that fails keeps the suite */
    it(
      "ends the turn on the chat line with nothing created, then explains the failure and keeps the suite",
      async () => {
        const langy = makeLangyAdapter();
        let scenariosAtProposal: Array<{ id: string; name: string }> | null =
          null;
        watcher = watchLangyConversation({
          adapter: langy,
          policy: { fallback: "allow_once" },
          answerQuestion: async (question) => {
            if (isProposalQuestion(question)) {
              scenariosAtProposal = await listProjectScenarios();
              return [GUIDED_OPTIONS.chatAboutThis];
            }
            return question.options?.[0]?.label
              ? [question.options[0].label]
              : [];
          },
        });
        await queueGuidedKickoff({
          adapter: langy,
          org,
          path: "llmops",
          tourStatus: "completed",
        });

        const seenTurns: string[] = [];
        let chatTurnText = "";
        let scenariosAfterChat: Array<{ id: string; name: string }> = [];
        let suitesAfterChat: Array<{ id: string; name: string }> = [];

        const result = await runScenarioAndLog({
          config: {
            name: "guided onboarding: chat about this, then a failing first scenario",
            description:
              'A developer of the ACME checkout agent (LangGraph; the discount code SPRING25 is expired and the agent refuses it) just signed up and picked Evals & LLM Ops. The app sends Langy the guided onboarding kickoff. The developer shares the folder. On Langy\'s proposal the developer picks the quiet "Chat about this" on the card, then asks for a scenario where SPRING25 must be accepted with 25% off, which the agent will fail. Langy must write and run it, explain the failure plainly, keep going with the suite, point at the run and close the path.',
            agents: [
              langy,
              scenario.userSimulatorAgent({ model }),
              scenario.judgeAgent({
                model,
                criteria: [
                  `Langy opens with, word for word: "${GUIDED_LINES.llmopsOpener}"`,
                  `Langy proposes the first scenario as one bare question card whose own text is the proposal, word for word from "${GUIDED_LINES.proposalStart}" up to the reason, above two options: one reading Create "<the scenario title>" as your first scenario test and the quiet "${GUIDED_OPTIONS.chatAboutThis}". The framework line, the pull request sentence and the branch line arrive as Langy's own lines right before that card, in that order, and nothing is said between the branch line and the card.`,
                  `When the developer picks "${GUIDED_OPTIONS.chatAboutThis}", Langy says, word for word, "${GUIDED_LINES.chatAboutThis}" and ends its turn there, creating nothing.`,
                  "After the developer describes the scenario, Langy writes it as described, opens it, runs it against the connected agent, and does not argue the developer out of it.",
                  "When the run fails, Langy explains in plain words what the judge saw and why the agent did not meet the criteria (the code was refused as expired), without blaming the developer and without hiding the failure.",
                  `After explaining the failure, Langy still says, word for word: "${GUIDED_LINES.proved}", and keeps going with the suite as a finding, not a blocker.`,
                  "Langy creates the suite with a few more scenarios, runs it, points at the run so the developer can replay the conversation, and closes the path.",
                  `Langy closes with, word for word: "${GUIDED_LINES.allReady}"`,
                  ...GUIDED_TONE_CRITERIA,
                  ...LANGY_CORE_RULE_CRITERIA,
                ],
              }),
            ],
            script: [
              scenario.agent(),
              async (_state, executor) => {
                await attachKickoffConversation({ org, adapter: langy });
                const conversationId = langy.state.conversationId ?? "";
                expect(langy.state.toolNames).toContain("code_access");
                await waitForPendingRequest({ conversationId });
                seenTurns.push(...watcher!.turnIds);
                if (langy.state.currentTurnId) {
                  seenTurns.push(langy.state.currentTurnId);
                }
                for (const note of watcher!.drainAnswerNotes()) {
                  await executor.message({ role: "user", content: note });
                }
              },
              // The folder is shared; the turn that follows sets up and
              // proposes, and the pick on the card is "Chat about this".
              async (_state, executor) => {
                terminal = await startShareControl({
                  repo,
                  label: "guided-chat",
                  // This conversation asked for the folder before the terminal started.
                  clearOpenRequests: false,
                });
                await terminal.approve();
                const conversationId = langy.state.conversationId ?? "";
                await waitForConnectedWorkspace({ conversationId });
                const autoTurnId = await watcher!.waitForNewTurn({
                  knownTurnIds: seenTurns,
                });
                seenTurns.push(autoTurnId);
                await watcher!.waitForIdle(LONG_RUN_TIMEOUT_MS);
                chatTurnText = await watcher!.lastAssistantText({
                  turnId: autoTurnId,
                });
                scenariosAfterChat = await listProjectScenarios();
                suitesAfterChat = await listProjectSuites();
                for (const message of await watcher!.lastTurnMessages({
                  turnId: autoTurnId,
                })) {
                  await executor.message(message as never);
                }
                for (const note of watcher!.drainAnswerNotes()) {
                  await executor.message({ role: "user", content: note });
                }
              },
              scenario.user(IMPOSSIBLE_SCENARIO),
              scenario.agent(),
              async (_state, executor) => {
                for (const note of watcher!.drainAnswerNotes()) {
                  await executor.message({ role: "user", content: note });
                }
              },
              scenario.judge(),
            ],
          },
        });

        console.log(terminalSection(terminal!));
        console.log(
          "[layer2] questions:",
          JSON.stringify(watcher.questions.map((ask) => ask.questions)),
        );

        // Chat about this: the proposal was a question with the quiet way
        // out, nothing existed while it was open, and the turn ended on the
        // chat line with nothing created.
        const proposal = watcher.questions
          .flatMap((ask) => ask.questions)
          .find((question) => isProposalQuestion(question));
        expect(proposal).toBeDefined();
        expect((proposal as { bare?: boolean }).bare).toBe(true);
        expect(carriesProposalText(proposal!)).toBe(true);
        expect(proposal!.options?.[1]?.label).toBe(
          GUIDED_OPTIONS.chatAboutThis,
        );
        expect(proposal!.options?.[1]?.quiet).toBe(true);
        expect(scenariosAtProposal).toEqual([]);
        expect(saysVerbatim(chatTurnText, GUIDED_LINES.chatAboutThis)).toBe(
          true,
        );
        expect(scenariosAfterChat).toEqual([]);
        expect(suitesAfterChat).toEqual([]);

        // The failing run keeps the suite.
        const stored = await conversationMessages(
          langy.state.conversationId ?? "",
        );
        const commands = storedCommands(stored);
        const outputs = storedOutputs(stored);
        const scenarios = await listProjectScenarios();
        const suites = await listProjectSuites();
        console.log(
          "[layer2] scenarios:",
          scenarios.map((s) => s.name).join(" | "),
        );
        console.log("[layer2] suites:", suites.map((s) => s.name).join(" | "));
        console.log("[layer2] navigate:", watcher.navigateHrefs.join(", "));
        console.log("[layer2] commands:", commands.join(" | "));
        expect(scenarios.length).toBeGreaterThanOrEqual(2);
        expect(suites.length).toBeGreaterThanOrEqual(1);
        expect(commands.some((c) => /scenario run/.test(c))).toBe(true);
        expect(commands.some((c) => /test-suite run/.test(c))).toBe(true);
        // The first run really failed on the judge: the run is scheduled and
        // read back, so the verdict is in the run command's output or in the
        // simulation-run read that follows it, before the suite runs.
        const firstRunAt = commands.findIndex((c) => /scenario run/.test(c));
        expect(firstRunAt).toBeGreaterThanOrEqual(0);
        const suiteRunAt = commands.findIndex((c) => /test-suite run/.test(c));
        const firstRunOutputs = outputs
          .slice(firstRunAt, suiteRunAt === -1 ? undefined : suiteRunAt)
          .filter((_, index) =>
            /scenario run|simulation-run get|simulation-runs? /.test(
              commands[firstRunAt + index] ?? "",
            ),
          )
          .join("\n");
        expect(firstRunOutputs).toMatch(/"verdict":\s*"failure"|FAILED/i);
        expect(firstRunOutputs).not.toMatch(/"status":\s*"ERROR"/);
        // The failed verdict still gets the two-things line: the agent
        // answered and the traces flowed.
        expect(
          saysVerbatim(storedAssistantText(stored), GUIDED_LINES.proved),
        ).toBe(true);
        expect(watcher.navigateHrefs.length).toBeGreaterThanOrEqual(2);
        expect(
          commands.some((c) =>
            /langwatch onboarding complete-path llmops/.test(c),
          ),
        ).toBe(true);
        assertPathCompletedAfterSkill({
          events: mergeToolEvents(langy.state.toolEvents, watcher.toolEvents),
          path: "llmops",
          after: [/langwatch test-suite run/],
        });
        const state = await waitForPathDone({
          organizationId: org.organizationId,
          path: "llmops",
        });
        expect(state.donePaths).toContain("llmops");

        const branches = repo.branches();
        console.log("[layer2] branches:", branches.join(", "));
        expect(branches.some((branch) => branch.startsWith("langy/"))).toBe(
          true,
        );

        if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
        expect(result.success).toBe(true);
      },
      LONG_RUN_TIMEOUT_MS + 900_000,
    );
  });
});

/** The bash tool parts of the stored conversation, in order. */
function commandParts(
  messages: Array<{ parts: Array<Record<string, unknown>> }>,
): Array<Record<string, unknown>> {
  return messages.flatMap((message) =>
    message.parts.filter(
      (part) =>
        typeof part.type === "string" &&
        part.type.startsWith("tool-") &&
        typeof (part.input as { command?: unknown } | undefined)?.command ===
          "string",
    ),
  );
}

function storedCommands(
  messages: Array<{ parts: Array<Record<string, unknown>> }>,
): string[] {
  return commandParts(messages).map((part) =>
    String((part.input as { command: string }).command),
  );
}

function storedAssistantText(
  messages: Array<{ role: string; parts: Array<Record<string, unknown>> }>,
): string {
  return messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text))
    .join("\n");
}

function storedOutputs(
  messages: Array<{ parts: Array<Record<string, unknown>> }>,
): string[] {
  return commandParts(messages).map((part) =>
    typeof part.output === "string"
      ? part.output
      : JSON.stringify(part.output ?? ""),
  );
}
