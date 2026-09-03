/**
 * A change to a running connected agent, made through the shared folder
 * (ADR-129).
 *
 * The demo application is running with `connectAgent`, so it answers
 * simulations from the platform. The developer asks for a free-plan-only case
 * on a named account. That is one change in the customer's program (a new run
 * parameter), one restart, and one re-registration, and every step is read
 * back: the diff, the terminal, and the agent the platform holds.
 *
 * RUN (one file per vitest run, see README):
 *   cd platform/app/e2e/langy && npx vitest run langy-local-connected-agent.scenario.test.ts --reporter=verbose
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
  type DemoApp,
  type DemoRepo,
  readAgent,
  setCodeAccessPreference,
  startDemoApp,
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

/** The connected agent the demo registers. */
const AGENT_NAME = "acme-support";

let repo: DemoRepo;
let terminal: CliTerminal | undefined;
let watcher: ConversationWatcher | undefined;
let app: DemoApp | undefined;

describe("Langy changes a connected agent through the shared folder", () => {
  beforeAll(async () => {
    assertToolsPresent();
    await setCodeAccessPreference(null);
    repo = await createDemoRepo({
      language: "typescript",
      name: "connected-agent",
    });
    app = await startDemoApp({ repo, label: "connected-agent" });
    // The agent registers a moment after the process starts; the scenario
    // premise is that it is already connected.
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }, 1_800_000);

  afterAll(async () => {
    await teardown({ terminal, watcher, app });
  });

  describe("when the agent runs from the shared folder", () => {
    /** @scenario A scenario checks that Langy adds a run parameter to a connected agent */
    it(
      "adds the run parameter, restarts the agent, and the platform sees it again",
      async () => {
        const before = await readAgent(AGENT_NAME);
        console.log(
          "[layer2] agent before:",
          JSON.stringify(before?.parameters),
        );

        const langy = makeLangyAdapter();
        watcher = watchLangyConversation({
          adapter: langy,
          policy: { fallback: "allow_once" },
        });
        terminal = await startShareControl({ repo, label: "connected-agent" });

        const seenTurns: string[] = [];

        const result = await runScenarioAndLog({
          config: {
            name: "a free-plan-only case on a named account",
            description:
              "The ACME support agent is connected to LangWatch from the developer's own machine. The developer wants the refund case to run on the free plan against the account acme-free, which needs a new run parameter in the connect call, a restart, and a scenario that sets it.",
            agents: [
              langy,
              scenario.userSimulatorAgent({ model }),
              scenario.judgeAgent({
                model,
                criteria: [
                  "Langy changes the connect call so the agent takes the account, or the plan, as a run parameter with the possible values as options.",
                  "Langy restarts the agent itself and confirms it registered again; it does not ask the developer to restart anything.",
                  "Langy says what it changed and how the case is run now.",
                  ...LANGY_CORE_RULE_CRITERIA,
                ],
              }),
            ],
            script: [
              // The ask names the outcome, not the change: the refund case
              // has to run on another account and another plan, and the agent
              // takes neither today. Naming the run parameter here would ask
              // the question the scenario exists to answer.
              scenario.user(
                "my refund scenario always runs on the pro plan. Let me pick the account and the plan when a run starts, and make that scenario run against the account acme-free on the free plan",
              ),
              scenario.agent(),
              async () => {
                const conversationId = langy.state.conversationId ?? "";
                // A failure here reads as an empty tool list otherwise, and
                // the reply is what says why Langy did not ask for the code.
                if (!langy.state.toolNames.includes("code_access")) {
                  console.log(
                    "[layer2] tools without code_access:",
                    langy.state.toolNames.join(", "),
                  );
                  console.log(
                    "[layer2] reply:",
                    await watcher!.lastAssistantText(),
                  );
                }
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
                await watcher!.waitForIdle(LONG_RUN_TIMEOUT_MS);
              },
              scenario.judge(),
            ],
          },
        });

        const branches = repo
          .branches()
          .filter((branch) => branch.startsWith("langy/"));
        const capture = terminal.capture();
        console.log("[layer2] branches:", repo.branches().join(", "));
        console.log("[layer2] tools:", langy.state.toolNames.join(", "));
        console.log(terminalSection(terminal));

        expect(branches.length).toBeGreaterThan(0);
        const diff = repo.diffAgainstMain(branches[0] as string);
        // The connect call takes the new parameter, with the accounts as its
        // options.
        expect(diff).toMatch(/src\/server\.ts/);
        expect(diff).toMatch(/account|plan/i);
        expect(diff).toMatch(/acme-free/);
        // The scenario the developer asked for sets the parameter.
        expect(diff).toMatch(/tests\//);

        // The restart went through the folder, in the background, so the turn
        // was never blocked by a process that does not exit.
        expect(langy.state.toolNames).toContain("local_bash");
        expect(capture).toMatch(/started in the background/i);

        // The platform holds the agent again, with the new parameter.
        const after = await readAgent(AGENT_NAME);
        console.log("[layer2] agent after:", JSON.stringify(after?.parameters));
        expect(JSON.stringify(after?.parameters ?? [])).toMatch(
          /account|plan/i,
        );

        if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
        expect(result.success).toBe(true);
      },
      LONG_RUN_TIMEOUT_MS,
    );
  });
});
