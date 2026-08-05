/**
 * @vitest-environment node
 *
 * Covers the @unit scenarios in
 * specs/scenarios/prompt-agent-input-binding.feature.
 */

import type { AgentInput } from "@langwatch/scenario";
import { describe, expect, it } from "vitest";
import {
  buildPromptTemplateContext,
  templateReferencesVariable,
} from "../prompt-template-context";

/**
 * A turn as the scenario runner hands it over: `ScenarioState.addMessage`
 * stamps every message with `id`, and the executor adds `traceId`.
 */
function turn(
  messages: Array<{ role: string; content: string }> = [
    { role: "user", content: "I need a refund" },
  ],
): AgentInput {
  return {
    threadId: "thread_abc123",
    messages: messages.map((message, index) => ({
      ...message,
      id: `scnmsg_${index}`,
      traceId: `trace_${index}`,
    })),
    newMessages: [],
    requestedRole: "agent",
    scenarioState: {},
    scenarioConfig: {},
  } as unknown as AgentInput;
}

describe("buildPromptTemplateContext", () => {
  describe("given the prompt declares inputs and no explicit mappings", () => {
    /** @scenario "A declared input is bound by name to a scenario source" */
    it("binds each declared input to the scenario source its name names", () => {
      const { context } = buildPromptTemplateContext({
        input: turn(),
        inputs: [
          { identifier: "question", type: "str" },
          { identifier: "thread_id", type: "str" },
        ],
      });

      expect(context.question).toBe("I need a refund");
      expect(context.thread_id).toBe("thread_abc123");
    });

    /** @scenario "The base scenario names remain available to a template" */
    it("still exposes input, messages and threadId", () => {
      const { context } = buildPromptTemplateContext({ input: turn() });

      expect(context.input).toBe("I need a refund");
      expect(context.threadId).toBe("thread_abc123");
      expect(context.messages).toContain("I need a refund");
    });
  });

  describe("given an explicit mapping", () => {
    /** @scenario "An explicit mapping wins over the name match" */
    it("uses the explicit mapping rather than the name match", () => {
      const { context } = buildPromptTemplateContext({
        input: turn(),
        inputs: [{ identifier: "question", type: "str" }],
        scenarioMappings: {
          question: { type: "value", value: "Use the knowledge base" },
        },
      });

      expect(context.question).toBe("Use the knowledge base");
    });

    /** @scenario "Explicit mappings do not unbind the inputs they leave out" */
    it("leaves the inputs it does not cover bound by name", () => {
      const { context, unboundInputs } = buildPromptTemplateContext({
        input: turn(),
        inputs: [
          { identifier: "question", type: "str" },
          { identifier: "thread_id", type: "str" },
        ],
        scenarioMappings: {
          question: { type: "value", value: "explicit" },
        },
      });

      expect(context.question).toBe("explicit");
      expect(context.thread_id).toBe("thread_abc123");
      expect(unboundInputs).toEqual([]);
    });
  });

  describe("given a mapping expressed in the shared resolver's terms", () => {
    /** @scenario "A prompt's declared inputs are bound through the shared resolver" */
    it("resolves a scenario-source mapping the way every other adapter does", () => {
      const { context } = buildPromptTemplateContext({
        input: turn(),
        inputs: [
          { identifier: "query", type: "str" },
          { identifier: "context", type: "str" },
        ],
        scenarioMappings: {
          query: { type: "source", sourceId: "scenario", path: ["input"] },
        },
      });

      expect(context.query).toBe("I need a refund");
    });
  });

  describe("given the prompt declares exactly one input", () => {
    /** @scenario "A prompt's only declared input receives the scenario message" */
    it("binds it to the latest user message whatever it is called", () => {
      const { context, unboundInputs } = buildPromptTemplateContext({
        input: turn(),
        inputs: [{ identifier: "customer_tier", type: "str" }],
      });

      expect(context.customer_tier).toBe("I need a refund");
      expect(unboundInputs).toEqual([]);
    });
  });

  describe("given a declared input nothing can be bound to", () => {
    /** @scenario "An input nothing can be bound to renders as a visible placeholder" */
    it("renders a placeholder and reports the input by name", () => {
      const { context, unboundInputs } = buildPromptTemplateContext({
        input: turn(),
        inputs: [
          { identifier: "question", type: "str" },
          { identifier: "customer_tier", type: "str" },
        ],
      });

      expect(context.customer_tier).toBe("[unbound input: customer_tier]");
      expect(unboundInputs).toEqual(["customer_tier"]);
    });
  });

  describe("given the runner's internal fields on every message", () => {
    /** @scenario "Internal message fields never reach prompt text" */
    it("keeps id and traceId out of every bound value", () => {
      const { context } = buildPromptTemplateContext({
        input: turn([
          { role: "user", content: "I need a refund" },
          { role: "assistant", content: "Sure, let me help" },
        ]),
        inputs: [{ identifier: "question", type: "str" }],
      });

      const everyBoundValue = Object.values(context).join("\n");
      expect(everyBoundValue).not.toContain("traceId");
      expect(everyBoundValue).not.toContain("scnmsg_");
      expect(context.messages).toContain("I need a refund");
      expect(context.messages).toContain("Sure, let me help");
    });

    /** @scenario "The conversation reaches prompt text as prose, not as JSON" */
    it("renders the conversation as prose rather than JSON", () => {
      const { context } = buildPromptTemplateContext({
        input: turn([
          { role: "user", content: "I need a refund" },
          { role: "assistant", content: "Sure, let me help" },
        ]),
      });

      expect(context.messages).toBe(
        "user: I need a refund\nassistant: Sure, let me help",
      );
      expect(context.messages).not.toMatch(/"role"\s*:/);
    });

    /** @scenario "A mapping that resolves to the conversation is sanitised too" */
    it("sanitises a declared input that resolves to the conversation", () => {
      const { context } = buildPromptTemplateContext({
        input: turn([
          { role: "user", content: "I need a refund" },
          { role: "assistant", content: "Sure" },
        ]),
        inputs: [{ identifier: "history", type: "str" }],
        scenarioMappings: {
          history: { type: "source", sourceId: "scenario", path: ["messages"] },
        },
      });

      expect(context.history).toBe("user: I need a refund\nassistant: Sure");
      expect(context.history).not.toContain("traceId");
      expect(context.history).not.toContain("scnmsg_");
    });
  });
});

describe("templateReferencesVariable", () => {
  describe("given the variable appears inside a Liquid expression", () => {
    /** @scenario "A template that reads the conversation places it itself" */
    it("reports the reference for an output tag", () => {
      expect(
        templateReferencesVariable("History: {{messages}}", "messages"),
      ).toBe(true);
    });

    /** @scenario "A loop over the conversation counts as reading it" */
    it("reports the reference for a loop tag", () => {
      expect(
        templateReferencesVariable(
          "{% for m in messages %}{{ m.content }}{% endfor %}",
          "messages",
        ),
      ).toBe(true);
    });
  });

  describe("given the word appears only outside a Liquid expression", () => {
    /** @scenario "The word 'messages' in prose does not suppress the conversation" */
    it("does not report a reference for ordinary prose", () => {
      expect(
        templateReferencesVariable(
          "Summarise the customer's messages politely.",
          "messages",
        ),
      ).toBe(false);
    });
  });

  describe("given the word appears only as a quoted literal", () => {
    /** @scenario "A quoted literal is not a reference to the conversation" */
    it("does not report a reference", () => {
      expect(templateReferencesVariable('{{ "messages" }}', "messages")).toBe(
        false,
      );
      expect(
        templateReferencesVariable("{% assign x = 'messages' %}", "messages"),
      ).toBe(false);
    });
  });
});
