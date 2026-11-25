import { AgentOfflineError } from "@langwatch/agent-contract";
import { UNNAMED_FAILURE } from "@langwatch/experiment-contract";
import type { ScenarioParameterDefinition } from "@langwatch/scenario-contract";
/**
 * What a workbench column sends to a connected agent, and what it reads back.
 *
 * @see specs/experiments-v3/connected-agent-target.feature
 */
import { describe, expect, it } from "vitest";

import {
  applyParametersToRows,
  fillDeclaredColumns,
} from "../../rules/experiment-execution-data.rules.ts";
import {
  buildConnectedCall,
  connectedCallFailure,
  connectedOutputText,
} from "../experiment-connected-target.process.ts";

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

    it("sends an object input as its JSON, not as [object Object]", () => {
      const { messages } = buildConnectedCall({
        inputs: { input: { order: 42, status: "late" } },
        definitions,
      });

      expect(messages).toEqual([{ role: "user", content: '{"order":42,"status":"late"}' }]);
    });

    it("sends an empty message when the row maps no input", () => {
      const { messages } = buildConnectedCall({ inputs: {}, definitions });

      expect(messages).toEqual([{ role: "user", content: "" }]);
    });
  });

  describe("when an attachment is mapped beside the text", () => {
    const png = `data:image/png;base64,${Buffer.from("png").toString("base64")}`;
    const pdf = `data:application/pdf;name=quarter.pdf;base64,${Buffer.from("pdf").toString(
      "base64",
    )}`;
    const wav = `data:audio/wav;name=call.wav;base64,${Buffer.from("wav").toString("base64")}`;

    /** @scenario "A connected agent receives the attachment beside the text" */
    it("sends a text part and an image part", () => {
      const { messages } = buildConnectedCall({
        inputs: { input: "what is on this screen?", attachment: png },
        definitions,
      });

      expect(messages).toEqual([
        {
          role: "user",
          content: [
            { type: "text", text: "what is on this screen?" },
            { type: "image_url", image_url: { url: png } },
          ],
        },
      ]);
    });

    /** @scenario "An attachment travels with the message" */
    it("sends a document as a file part that carries its name", () => {
      const { messages } = buildConnectedCall({
        inputs: { input: "summarize", attachment: pdf },
        definitions,
      });

      expect(messages[0]?.content).toEqual([
        { type: "text", text: "summarize" },
        {
          type: "file",
          file: { filename: "quarter.pdf", file_data: pdf },
        },
      ]);
    });

    it("sends a recording as an audio part in its own format", () => {
      const { messages } = buildConnectedCall({
        inputs: { input: "", attachment: wav },
        definitions,
      });

      expect(messages[0]?.content).toEqual([
        {
          type: "input_audio",
          input_audio: {
            data: Buffer.from("wav").toString("base64"),
            format: "wav",
          },
        },
      ]);
    });

    it("keeps one text message when nothing is attached", () => {
      const { messages } = buildConnectedCall({
        inputs: { input: "hello", attachment: "" },
        definitions,
      });

      expect(messages).toEqual([{ role: "user", content: "hello" }]);
    });

    it("sends no parameter named after the attachment field", () => {
      const { params } = buildConnectedCall({
        inputs: { input: "hello", attachment: png },
        definitions,
      });

      expect(params).not.toHaveProperty("attachment");
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
    it("sends nothing for a parameter left unmapped, so the default applies", () => {
      const { params } = buildConnectedCall({ inputs: { input: "hi" }, definitions });

      expect(params).toEqual({});
    });
  });

  describe("when a text parameter is mapped to an empty column", () => {
    /** @scenario "A text parameter mapped to an empty column is sent as empty text" */
    it("sends the parameter as empty text", () => {
      const { params } = buildConnectedCall({ inputs: { input: "hi", plan: "" }, definitions });

      expect(params).toEqual({ plan: "" });
    });

    /** @scenario "A text parameter mapped to an empty column is sent as empty text" */
    it("sends a null cell as empty text too", () => {
      const { params } = buildConnectedCall({ inputs: { input: "hi", plan: null }, definitions });

      expect(params).toEqual({ plan: "" });
    });
  });

  describe("when a parameter is mapped to a column the dataset does not have", () => {
    /** @scenario "A parameter mapped to a column the dataset does not have is left out" */
    it("leaves the parameter out, so the default applies", () => {
      const { params } = buildConnectedCall({
        inputs: { input: "hi", plan: undefined },
        definitions,
      });

      expect(params).not.toHaveProperty("plan");
    });
  });

  describe("when a number, a boolean and a fixed choice are mapped to empty cells", () => {
    /** @scenario "An empty cell for a number, a boolean or a fixed choice keeps the default" */
    it("sends none of them", () => {
      const { params } = buildConnectedCall({
        inputs: { input: "hi", model: "", max_tools: "", verbose: "" },
        definitions,
      });

      expect(params).toEqual({});
    });
  });

  describe("when a run parameter fills a column empty in every row", () => {
    /** @scenario "A run parameter fills a column left empty in every row" */
    it("sends the run parameter's value on every row", () => {
      const columns = [
        { id: "input", name: "input", type: "string" },
        { id: "environment", name: "environment", type: "string" },
      ];
      const { rows } = applyParametersToRows({
        rows: fillDeclaredColumns({ rows: [{ input: "a" }, { input: "b" }], columns }),
        columns,
        parameters: { environment: "staging" },
      });

      const plans = rows.map(
        (row) =>
          buildConnectedCall({
            inputs: { input: row.input, plan: row.environment },
            definitions,
          }).params.plan,
      );

      expect(plans).toEqual(["staging", "staging"]);
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
