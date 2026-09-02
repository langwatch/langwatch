/**
 * What a connected agent reads as a workbench column.
 *
 * @see specs/experiments-v3/connected-agent-target.feature
 */
import { describe, expect, it } from "vitest";
import { connectedTargetFields } from "../utils/connectedAgentTarget";

const agent = {
  parameters: [
    {
      name: "model",
      type: "string",
      options: ["gpt-5", "gpt-5-mini"],
      defaultValue: "gpt-5-mini",
    },
    { name: "plan", type: "string", description: "Customer plan" },
    { name: "max_tools", type: "number" },
    { name: "verbose", type: "boolean" },
    { name: "api_token", type: "string", secret: true },
  ],
};

describe("given a connected agent is added as a target", () => {
  /** @scenario "The declared parameters are column inputs" */
  describe("when the column is built", () => {
    it("reads the turn to send and every declared parameter", () => {
      const { inputs } = connectedTargetFields(agent);

      expect(inputs.map((input) => input.identifier)).toEqual([
        "input",
        "model",
        "plan",
        "max_tools",
        "verbose",
      ]);
    });

    it("keeps the parameters optional, so a column that maps none still runs", () => {
      const { inputs } = connectedTargetFields(agent);

      expect(inputs[0]).toEqual({ identifier: "input", type: "str" });
      expect(inputs.slice(1).every((input) => input.optional)).toBe(true);
    });

    it("edits each parameter as the type it declares", () => {
      const byName = new Map(
        connectedTargetFields(agent).inputs.map((input) => [
          input.identifier,
          input.type,
        ]),
      );

      expect(byName.get("model")).toBe("str");
      expect(byName.get("max_tools")).toBe("float");
      expect(byName.get("verbose")).toBe("bool");
    });

    it("leaves a secret out: a column mapping is not where a credential goes", () => {
      const { inputs } = connectedTargetFields(agent);

      expect(inputs.some((input) => input.identifier === "api_token")).toBe(
        false,
      );
    });

    it("writes the answer to one output", () => {
      expect(connectedTargetFields(agent).outputs).toEqual([
        { identifier: "output", type: "str" },
      ]);
    });
  });

  describe("when the agent declares no parameters", () => {
    it("reads the turn alone", () => {
      expect(connectedTargetFields({}).inputs).toEqual([
        { identifier: "input", type: "str" },
      ]);
    });
  });
});
