/**
 * The folder goes away while Langy is working (ADR-129).
 *
 * The developer presses Ctrl-C in the middle of a turn. Langy's next tool call
 * reads the offline pushback, so the turn has to end in words that say the
 * folder is gone, and the next code ask has to record a fresh control request
 * rather than carrying on as if the machine were still there.
 *
 * RUN (one file per vitest run, see README):
 *   cd platform/app/e2e/langy && npx vitest run langy-local-disconnect.scenario.test.ts --reporter=verbose
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

const LONG_RUN_TIMEOUT_MS = 2_400_000;

/** How long the turn is left to work before the command line is stopped. */
const WORK_BEFORE_DISCONNECT_MS = 25_000;

let repo: DemoRepo;
let terminal: CliTerminal | undefined;
let watcher: ConversationWatcher | undefined;

describe("Langy notices when the shared folder goes away", () => {
  beforeAll(async () => {
    assertToolsPresent();
    await setCodeAccessPreference(null);
    repo = await createDemoRepo({
      language: "python",
      name: "disconnect",
      install: false,
    });
  }, 900_000);

  afterAll(async () => {
    await teardown({ terminal, watcher });
  });

  describe("when the command line exits mid-task", () => {
    /** @scenario A scenario checks that Langy recovers when the folder disconnects mid-task */
    it(
      "says the folder is gone and asks for it again on the next code ask",
      async () => {
        const langy = makeLangyAdapter();
        watcher = watchLangyConversation({
          adapter: langy,
          policy: { fallback: "allow_once" },
        });
        terminal = await startShareControl({ repo, label: "disconnect" });

        const seenTurns: string[] = [];

        const result = await runScenarioAndLog({
          config: {
            name: "the folder disconnects while Langy works",
            description:
              "The developer shares a folder, Langy starts a change, and the developer stops the command line half way. Langy must say the folder is no longer connected instead of reporting work it could not do.",
            agents: [
              langy,
              scenario.userSimulatorAgent({ model }),
              scenario.judgeAgent({
                model,
                criteria: [
                  "Langy says plainly that the shared folder is no longer connected.",
                  "Langy does not claim the change was made or that the work carried on.",
                  "Langy offers to reconnect the folder, or to reach the code another way.",
                  ...LANGY_CORE_RULE_CRITERIA,
                ],
              }),
            ],
            script: [
              scenario.user(
                "add type hints to the account store in this project",
              ),
              scenario.agent(),
              async () => {
                const conversationId = langy.state.conversationId ?? "";
                expect(langy.state.toolNames).toContain("code_access");
                await waitForPendingRequest({ conversationId });
                seenTurns.push(...watcher!.turnIds);
                if (langy.state.currentTurnId) {
                  seenTurns.push(langy.state.currentTurnId);
                }
                await terminal!.approve();
                await waitForConnectedWorkspace({ conversationId });
                const autoTurnId = await watcher!.waitForNewTurn({
                  knownTurnIds: seenTurns,
                });
                seenTurns.push(autoTurnId);
                // The Ctrl-C lands WHILE the turn the connection started is
                // still working, which is the whole point of the scenario.
                setTimeout(() => {
                  void terminal!.disconnect();
                }, WORK_BEFORE_DISCONNECT_MS);
                await watcher!.waitForIdle(LONG_RUN_TIMEOUT_MS);
              },
              scenario.user("what happened? is the change in?"),
              scenario.agent(),
              scenario.judge(),
            ],
          },
        });

        const conversationId = langy.state.conversationId ?? "";
        const capture = terminal.capture();
        const outputs = langy.state.toolOutputs.join("\n");
        const afterDisconnect = await getLocalWorkspace(conversationId);
        console.log(
          "[layer2] workspace after Ctrl-C:",
          JSON.stringify({
            connected: afterDisconnect.connected,
            pendingRequest: afterDisconnect.pendingRequest,
          }),
        );
        console.log(
          "[layer2] workspace events:",
          watcher.workspaceEvents.map((event) => event.state).join(", "),
        );
        console.log(terminalSection(terminal));

        // The command line said it was leaving, and the platform saw it go.
        expect(capture).toMatch(/Leaving|disconnected/i);
        expect(afterDisconnect.connected).toBe(false);
        expect(watcher.workspaceEvents.map((event) => event.state)).toContain(
          "disconnected",
        );
        // Either the model read the offline pushback, or it had already
        // stopped calling the folder; the reply is what carries the news.
        console.log(
          "[layer2] offline pushback seen:",
          /not connected/.test(outputs),
        );

        if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
        expect(result.success).toBe(true);

        // The next code ask records a fresh request rather than assuming the
        // folder is still there.
        const again = makeLangyAdapter();
        await runScenarioAndLog({
          config: {
            name: "the next code ask offers the folder again",
            description:
              "After the folder went away, the developer asks for another change. Langy must offer the two ways to reach the code again.",
            agents: [
              again,
              scenario.userSimulatorAgent({ model }),
              scenario.judgeAgent({
                model,
                criteria: [
                  "Langy offers the two ways to reach the code again.",
                  ...LANGY_CORE_RULE_CRITERIA,
                ],
              }),
            ],
            script: [
              scenario.user("instrument my traces with langwatch"),
              scenario.agent(),
              scenario.judge(),
            ],
          },
        });
        const freshRequest = await waitForPendingRequest({
          conversationId: again.state.conversationId ?? "",
        });
        expect(freshRequest.id).not.toBe("");
      },
      LONG_RUN_TIMEOUT_MS,
    );
  });
});
