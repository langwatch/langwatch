/**
 * Scenario tests for the refund rule.
 *
 * Both tests run the agent in this process, no HTTP server needed. The pro
 * test runs the connected agent itself, so the simulation on the platform and
 * this test share one code path.
 */
import "dotenv/config";

import { openai } from "@ai-sdk/openai";
import scenario, { AgentRole, type AgentAdapter } from "@langwatch/scenario";
import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";

import { answerTurn } from "../src/agent.js";
import { acmeSupport } from "../src/server.js";

const judgeModel = openai("gpt-5-mini");

/**
 * The support turn on the free account. The connected agent works on one
 * hardcoded account, so this test calls the turn function with the account it
 * needs.
 */
const freePlanAgent: AgentAdapter = {
  role: AgentRole.AGENT,
  async call(input) {
    return await answerTurn({
      messages: input.messages as ModelMessage[],
      accountId: "acme-free",
    });
  },
};

describe("the refund rule", () => {
  it("refunds above the limit on the pro plan", async () => {
    const result = await scenario.run({
      name: "pro plan refund",
      description:
        "The customer of the pro account acme-pro asks for a refund of 79.90 dollars on order A-2002.",
      agents: [
        acmeSupport,
        scenario.userSimulatorAgent({ model: judgeModel }),
        scenario.judgeAgent({
          model: judgeModel,
          criteria: [
            "The agent confirms that the refund was made",
            "The agent does not say that the plan blocks the refund",
            "The agent does not ask the customer to contact somebody else",
          ],
        }),
      ],
      script: [
        scenario.user("Order A-2002 arrived damaged, please refund 79.90 dollars."),
        scenario.agent(),
        scenario.judge(),
      ],
    });

    expect(result.success, result.reasoning).toBe(true);
  });

  it("refuses a refund above the limit on the free plan", async () => {
    const result = await scenario.run({
      name: "free plan refund limit",
      description:
        "The customer of the free account acme-free asks for a refund of 80 dollars on order A-1002, above the 50 dollar limit of the free plan.",
      agents: [
        freePlanAgent,
        scenario.userSimulatorAgent({ model: judgeModel }),
        scenario.judgeAgent({
          model: judgeModel,
          criteria: [
            "The agent says that the free plan does not allow a refund of this amount",
            "The agent offers to escalate the request to a human support agent",
            "The agent does not claim that the refund was made",
          ],
        }),
      ],
      script: [
        scenario.user("Order A-1002 broke on the first day, please refund 80 dollars."),
        scenario.agent(),
        scenario.judge(),
      ],
    });

    expect(result.success, result.reasoning).toBe(true);
  });
});
