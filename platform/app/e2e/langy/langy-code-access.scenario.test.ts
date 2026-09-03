/**
 * The shared folder, end to end: the user asks for tracing, Langy offers the
 * two ways to reach the code, the command line shares the folder, and Langy
 * makes the change on the developer's own machine (ADR-129).
 *
 * Layer 2 is the repository itself. The branch, the commit and the diff are
 * read from git before the judge is asked anything, because a judge will
 * happily read a well-written promise as a change.
 *
 * RUN (one file per vitest run, see README):
 *   cd platform/app/e2e/langy && npx vitest run langy-code-access.scenario.test.ts --reporter=verbose
 */

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeLangyAdapter } from "./langy-agent";
import { LANGY_CORE_RULE_CRITERIA } from "./langy-rules";
import {
  assertToolsPresent,
  type CliTerminal,
  type ConversationWatcher,
  createDemoRepo,
  type DemoRepo,
  getLocalWorkspace,
  setCodeAccessPreference,
  startShareControl,
  teardown,
  terminalSection,
  waitForConnectedWorkspace,
  waitForPendingRequest,
  watchLangyConversation,
} from "./local-control-fixture";
import { runScenarioAndLog } from "./scenario-logger";

const model = openai("gpt-5-mini");

/** The budget of a run that installs an SDK, edits code and runs a test suite. */
const LONG_RUN_TIMEOUT_MS = 2_400_000;

let repo: DemoRepo;
let terminal: CliTerminal | undefined;
let watcher: ConversationWatcher | undefined;

describe("Langy reaches the code through the shared folder", () => {
  beforeAll(async () => {
    assertToolsPresent();
    // The remembered choice is per user and outlives a run, so a leftover
    // "GitHub" from the sibling suite would silence the very card this file
    // is about.
    await setCodeAccessPreference(null);
    repo = await createDemoRepo({ language: "python", name: "code-access" });
  }, 1_200_000);

  afterAll(async () => {
    await teardown({ terminal, watcher });
  });

  describe("when the user asks for tracing and shares the folder", () => {
    /** @scenario A scenario checks that Langy instruments tracing through a shared folder */
    it(
      "offers both ways, works on a branch, and commits the SDK calls",
      async () => {
        const langy = makeLangyAdapter();
        watcher = watchLangyConversation({
          adapter: langy,
          // The developer at the keyboard says yes to their project's own
          // commands. The refusals this feature rests on are the command
          // line's, not this policy's.
          policy: { fallback: "allow_once" },
        });
        terminal = await startShareControl({ repo, label: "code-access" });

        const seenTurns: string[] = [];
        let pendingRequestId = "";
        let autoTurnText = "";

        const result = await runScenarioAndLog({
          config: {
            name: "instrument tracing through the shared folder",
            description:
              "A developer of the ACME support agent asks Langy to instrument their traces. The application has no tracing at all. Langy must offer the two ways to reach the code, take the folder the developer shares, and make the change there.",
            agents: [
              langy,
              scenario.userSimulatorAgent({ model }),
              scenario.judgeAgent({
                model,
                criteria: [
                  "Langy explains, once, that it can make the change itself either on the developer's machine or through GitHub.",
                  "Langy does not ask how to reach the code a second time after the folder is connected.",
                  "While the folder is connected Langy never hands the user a command to run by hand; it does the work itself.",
                  "Langy reports what it changed and where the change is, naming the branch or the pull request.",
                  ...LANGY_CORE_RULE_CRITERIA,
                ],
              }),
            ],
            script: [
              scenario.user("instrument my traces with langwatch"),
              scenario.agent(),
              // Layer 2, first: the card really recorded a control request
              // for this conversation.
              async () => {
                const conversationId = langy.state.conversationId ?? "";
                expect(conversationId).not.toBe("");
                // The card comes from the tool, so a missing tool call is a
                // clearer failure than a request that never appears.
                expect(langy.state.toolNames).toContain("code_access");
                const request = await waitForPendingRequest({ conversationId });
                pendingRequestId = request.id;
                seenTurns.push(...watcher!.turnIds);
                if (langy.state.currentTurnId) {
                  seenTurns.push(langy.state.currentTurnId);
                }
              },
              // The developer picks the local folder: approving in the
              // terminal is the whole of that choice.
              async (_state, executor) => {
                await terminal!.approve();
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
                autoTurnText = await watcher!.lastAssistantText();
                await executor.message({
                  role: "assistant",
                  content: autoTurnText,
                });
              },
              scenario.judge(),
            ],
          },
        });

        // Layer 2: the folder, as git sees it.
        const branches = repo.branches();
        const langyBranches = branches.filter((branch) =>
          branch.startsWith("langy/"),
        );
        const capture = terminal.capture();
        console.log("[layer2] branches:", branches.join(", "));
        console.log("[layer2] commits:", repo.log().join(" | "));
        console.log("[layer2] status:", JSON.stringify(repo.status()));
        console.log(
          "[layer2] permission asks:",
          watcher.permissions.map((ask) => ask.summary).join(" | "),
        );
        console.log(terminalSection(terminal));

        expect(pendingRequestId).not.toBe("");
        expect(langyBranches.length).toBeGreaterThan(0);
        const branch = langyBranches[0] as string;
        const diff = repo.diffAgainstMain(branch);
        // The SDK reaches the entry point, which is where the turn is built.
        expect(diff).toMatch(/langwatch/i);
        expect(diff).toMatch(/app\/agent\.py|app\/main\.py/);
        // A branch with no commit of its own is a promise, not a change.
        expect(repo.log().length).toBeGreaterThan(1);
        // The project's own checks ran on the machine before the commit.
        expect(capture).toMatch(/bash .*(pytest|uv run|python)/);
        // The pull request step was attempted. `gh` is not signed in on a test
        // machine, so reporting the branch is the product's own answer to
        // that; either outcome passes, saying nothing does not.
        expect(autoTurnText).toMatch(/pull request|branch|langy\//i);

        if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
        expect(result.success).toBe(true);

        // The conversation holds the folder now, so nothing asks again.
        const status = await getLocalWorkspace(
          langy.state.conversationId ?? "",
        );
        expect(status.connected).toBe(true);
        expect(status.pendingRequest).toBeNull();
      },
      LONG_RUN_TIMEOUT_MS,
    );
  });
});
