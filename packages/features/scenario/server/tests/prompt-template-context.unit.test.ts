/**
 * @vitest-environment node
 *
 * Covers the @unit scenarios in
 * specs/scenarios/prompt-agent-input-binding.feature.
 */

import {
  ScenarioExecutionState,
  AgentRole,
  type AgentInput,
  type ScenarioConfig,
} from "@langwatch/scenario";
import { describe, expect, it } from "vitest";
import { buildPromptTemplateContext, templateReferencesVariable } from "../src";

/**
 * A turn as the scenario runner hands it over: `ScenarioState.addMessage`
 * stamps every message with `id`, and the executor adds `traceId`.
 */
function turn(
  messages: AgentInput["messages"] = [{ role: "user", content: "I need a refund" }],
): AgentInput {
  const scenarioConfig: ScenarioConfig = {
    name: "Prompt template context test",
    description: "Typed runner input fixture",
    agents: [],
  };
  const scenarioState = new ScenarioExecutionState(scenarioConfig);

  return {
    threadId: "thread_abc123",
    messages: messages.map((message, index) => ({
      ...message,
      id: `scnmsg_${index}`,
      traceId: `trace_${index}`,
    })),
    newMessages: [],
    requestedRole: AgentRole.AGENT,
    scenarioState,
    scenarioConfig,
  };
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

  describe("given the runner supplies no thread id for the turn", () => {
    /** @scenario "A thread-mapped input matches the base threadId when the runner supplies none" */
    it("binds a thread-mapped input to the same fallback as threadId", () => {
      const input = turn();
      (input as { threadId?: string }).threadId = undefined;

      const { context, unboundInputs } = buildPromptTemplateContext({
        input,
        inputs: [{ identifier: "thread_id", type: "str" }],
      });

      expect(context.thread_id).toBe(context.threadId);
      expect(context.thread_id).not.toBe("");
      expect(unboundInputs).toEqual([]);
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
    /** @scenario "A prompt receives the value its binding names" */
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

    /** @scenario "The conversation reads as a transcript, not as a payload" */
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

    /** @scenario "A template that needs the conversation structured can still get it" */
    it("keeps a sanitised structured conversation available as messagesJson", () => {
      const { context } = buildPromptTemplateContext({
        input: turn([
          { role: "user", content: "I need a refund" },
          { role: "assistant", content: "Sure, let me help" },
        ]),
      });

      expect(JSON.parse(context.messagesJson as string)).toEqual([
        { role: "user", content: "I need a refund" },
        { role: "assistant", content: "Sure, let me help" },
      ]);
      expect(context.messagesJson).not.toContain("traceId");
      expect(context.messagesJson).not.toContain("scnmsg_");
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
      expect(templateReferencesVariable("History: {{messages}}", "messages")).toBe(true);
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
      expect(templateReferencesVariable('{{ "messages" }}', "messages")).toBe(false);
      expect(templateReferencesVariable("{% assign x = 'messages' %}", "messages")).toBe(
        false,
      );
    });
  });
});

describe("run parameters in the prompt template context", () => {
  describe("given a run that resolved values", () => {
    /** @scenario "A prompt target reads params in its prompt template" */
    it("makes each one reachable as params.NAME", () => {
      const { context } = buildPromptTemplateContext({
        input: turn([{ role: "user", content: "hi" }]),
        parameters: { account_tier: "platinum", seats: 12 },
      });

      expect(context.params).toEqual({ account_tier: "platinum", seats: 12 });
    });

    it("leaves the conversation bindings alone", () => {
      const { context } = buildPromptTemplateContext({
        input: turn([{ role: "user", content: "hi" }]),
        parameters: { input: "not the conversation", messages: "nor this" },
      });

      expect(context.input).toBe("hi");
      expect(context.messages).toBe("user: hi");
    });
  });

  describe("given a run that resolved none", () => {
    it("binds an empty namespace rather than nothing", () => {
      const { context } = buildPromptTemplateContext({
        input: turn([{ role: "user", content: "hi" }]),
      });

      expect(context.params).toEqual({});
    });
  });
});
