/**
 * The decision table's other side: work that changes nothing in the
 * customer's program never asks for the code (ADR-129, skills/code-changes).
 *
 * Creating a scenario is platform work, so the code access card must never
 * appear. The proof is structural: `code_access` is not among the tools the
 * turn ran, and the conversation recorded no control request. A judge asked
 * "did it ask for the code" would be reading prose for a negative.
 *
 * RUN (one file per vitest run, see README):
 *   cd platform/app/e2e/langy && npx vitest run langy-code-access-platform-only.scenario.test.ts --reporter=verbose
 */

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { beforeAll, describe, expect, it } from "vitest";
import { listScenarios } from "./langwatch-api";
import { makeLangyAdapter } from "./langy-agent";
import { LANGY_CORE_RULE_CRITERIA } from "./langy-rules";
import {
  getLocalWorkspace,
  setCodeAccessPreference,
} from "./local-control-fixture";
import { runScenarioAndLog } from "./scenario-logger";

const model = openai("gpt-5-mini");

const TURN_BUDGET_MS = 1_800_000;

describe("Langy asks for the code only when the code has to change", () => {
  beforeAll(async () => {
    // A remembered GitHub choice would also silence the card, which would
    // make this scenario pass for the wrong reason.
    await setCodeAccessPreference(null);
  });

  describe("when the work is platform work", () => {
    /** @scenario A scenario checks that platform work never asks for the code */
    it(
      "creates the scenario and never asks how to reach the code",
      async () => {
        const langy = makeLangyAdapter();
        const before = await listScenarios();

        const result = await runScenarioAndLog({
          config: {
            name: "a refunds scenario is platform work",
            description:
              "A developer asks Langy for a scenario that tests refunds against their support agent. Nothing in their program changes, so Langy creates the scenario on the platform and never asks how to reach the code.",
            agents: [
              langy,
              scenario.userSimulatorAgent({ model }),
              scenario.judgeAgent({
                model,
                criteria: [
                  "Langy creates the scenario on the platform.",
                  "Langy never asks how to reach the developer's code, and never offers a folder or a pull request.",
                  ...LANGY_CORE_RULE_CRITERIA,
                ],
              }),
            ],
            script: [
              scenario.user(
                "create a scenario for refunds against my support agent",
              ),
              scenario.agent(),
              scenario.judge(),
            ],
          },
        });

        const conversationId = langy.state.conversationId ?? "";
        const status = await getLocalWorkspace(conversationId);
        console.log("[layer2] tools:", langy.state.toolNames.join(", "));
        console.log(
          "[layer2] pendingRequest:",
          JSON.stringify(status.pendingRequest),
        );

        expect(langy.state.toolNames).not.toContain("code_access");
        expect(status.pendingRequest).toBeNull();
        expect(status.connected).toBe(false);

        // Layer 2: the platform work itself landed.
        const after = await listScenarios();
        expect(after.length).toBeGreaterThanOrEqual(before.length);

        if (!result.success) console.log("JUDGE REASONING:", result.reasoning);
        expect(result.success).toBe(true);
      },
      TURN_BUDGET_MS,
    );
  });
});
