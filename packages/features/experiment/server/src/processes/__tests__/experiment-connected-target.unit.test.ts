/**
 * What a workbench column sends to a connected agent, and what it reads back.
 *
 * @see specs/experiments-v3/connected-agent-target.feature
 */
import { describe, expect, it } from "vitest";
import { AgentOfflineError } from "@langwatch/agent-contract";
import type { ScenarioParameterDefinition } from "@langwatch/scenario-contract";
import {
  buildConnectedCall,
  connectedCallFailure,
  connectedOutputText,
} from "../experiment-connected-target.process";
import { UNNAMED_FAILURE } from "@langwatch/experiment-contract";

const definitions: ScenarioParameterDefinition[] = [
  { name: "model", type: "string", options: ["gpt-5", "gpt-5-mini"] },
  { name: "plan", type: "string", defaultValue: "free" },
  { name: "max_tools", type: "number" },
  { name: "verbose", type: "boolean" },
];

describe("given a connected agent column", () => {
  describe("when the row carries the mapped input", () => {
    /** @scenario "The column reads the dataset row and answers" */
    it("sends the row's input as one user message", () => {
      const { messages } = buildConnectedCall({
        inputs: { input: "How do I return a broken item?" },
        definitions,
      });

      expect(messages).toEqual([{ role: "user", content: "How do I return a broken item?" }]);
    });

    it("keeps a conversation the dataset already holds", () => {
      const conversation = [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "my order is late" },
      ];

      const { messages } = buildConnectedCall({
        inputs: { input: conversation },
        definitions,
      });

      expect(messages).toEqual(conversation);
    });
  });

  describe("when parameter values are mapped", () => {
    /** @scenario "A parameter value reaches the agent as its declared type" */
    it("sends each value as the type the agent declared", () => {
      const { params } = buildConnectedCall({
        inputs: {
          input: "hi",
          model: "gpt-5",
          max_tools: "3",
          verbose: "true",
        },
        definitions,
      });

      expect(params).toEqual({ model: "gpt-5", max_tools: 3, verbose: true });
    });

    /** @scenario "A parameter value reaches the agent as its declared type" */
    it("drops a name the agent does not declare", () => {
      const { params } = buildConnectedCall({
        inputs: { input: "hi", temperature: "0.7" },
        definitions,
      });

      expect(params).not.toHaveProperty("temperature");
    });

    /** @scenario "The declared parameters are column inputs" */
    it("sends nothing for a parameter with no value, so the default applies", () => {
      const { params } = buildConnectedCall({
        inputs: { input: "hi", model: "" },
        definitions,
      });

      expect(params).toEqual({});
    });
  });
});

describe("given the agent answered", () => {
  describe("when the function returned a message rather than a string", () => {
    /** @scenario "The answer is text, whatever shape the function returned" */
    it("reads the message content", () => {
      expect(connectedOutputText({ role: "assistant", content: "two days" })).toBe("two days");
    });

    it("reads the last message of a list", () => {
      expect(
        connectedOutputText([
          { role: "assistant", content: "let me check" },
          { role: "assistant", content: "two days" },
        ]),
      ).toBe("two days");
    });

    it("joins the text parts of a multimodal message", () => {
      expect(
        connectedOutputText({
          role: "assistant",
          content: [
            { type: "text", text: "two " },
            { type: "text", text: "days" },
          ],
        }),
      ).toBe("two days");
    });
  });

  describe("when the function returned text", () => {
    it("reads it as it is", () => {
      expect(connectedOutputText("two days")).toBe("two days");
    });
  });
});

describe("given the call failed", () => {
  describe("when the platform named the failure", () => {
    /** @scenario "An offline agent names itself in the failure" */
    it("records the code, so the cell renders the copy of that code", () => {
      const failure = connectedCallFailure(
        new AgentOfflineError({
          agentName: "Support agent",
          environment: "production",
        }),
      );

      expect(failure.message).toBe("agent_offline");
      expect(failure.domainError?.code).toBe("agent_offline");
    });
  });

  describe("when nothing named the failure", () => {
    it("stays unnamed rather than showing a stack message", () => {
      const failure = connectedCallFailure(new Error("socket hang up"));

      expect(failure).toEqual({ message: UNNAMED_FAILURE });
    });
  });
});
