/**
 * @vitest-environment node
 *
 * Covers specs/scenarios/http-agent-body-template-json-safety.feature.
 *
 * Regression: a customer's scenario against an n8n webhook failed with
 * `HTTP 422 ... Bad control character in string literal in JSON` because the
 * body template `{"chatInput": "{{ input }}"}` interpolated a conversation
 * turn containing a raw newline straight into a JSON string literal. The body
 * engine must JSON-escape scalar interpolations the way the URL engine
 * URL-encodes its own.
 */

import { type AgentInput, AgentRole } from "@langwatch/scenario";
import { describe, expect, it } from "vitest";
import type { FieldMapping } from "../../field-mapping";
import {
  buildTemplateContext,
  renderBodyTemplate,
} from "../http-template-engine";

function inputWith(content: string | unknown[]): AgentInput {
  return {
    threadId: "thread-1",
    messages: [{ role: "user", content: content as string }],
    newMessages: [{ role: "user", content: content as string }],
    requestedRole: AgentRole.AGENT,
    scenarioState: {} as AgentInput["scenarioState"],
    scenarioConfig: {} as AgentInput["scenarioConfig"],
  };
}

function render({
  template,
  input,
  scenarioMappings,
}: {
  template: string;
  input: AgentInput;
  scenarioMappings?: Record<string, FieldMapping>;
}): string {
  return renderBodyTemplate({
    template,
    context: buildTemplateContext({ input, scenarioMappings }),
  });
}

describe("body template JSON safety", () => {
  describe("given a scalar value interpolated inside a JSON string literal", () => {
    describe("when the value contains a newline", () => {
      /** @scenario A user message with a newline is escaped inside a JSON string literal */
      it("escapes it so the body is valid JSON", () => {
        const body = render({
          template: '{"chatInput": "{{ input }}"}',
          input: inputWith("line one\nline two"),
        });

        expect(() => JSON.parse(body)).not.toThrow();
        expect(JSON.parse(body).chatInput).toBe("line one\nline two");
      });
    });

    describe("when the value contains a double quote", () => {
      /** @scenario A user message containing a double quote is escaped */
      it("escapes it so the body is valid JSON", () => {
        const body = render({
          template: '{"chatInput": "{{ input }}"}',
          input: inputWith('she said "hi"'),
        });

        expect(JSON.parse(body).chatInput).toBe('she said "hi"');
      });
    });

    describe("when the value contains a backslash", () => {
      /** @scenario A user message containing a backslash is escaped */
      it("escapes it so the body is valid JSON", () => {
        const body = render({
          template: '{"chatInput": "{{ input }}"}',
          input: inputWith("path C:\\temp\\new"),
        });

        expect(JSON.parse(body).chatInput).toBe("path C:\\temp\\new");
      });
    });

    describe("when the value contains a tab and a carriage return", () => {
      it("escapes both control characters", () => {
        const body = render({
          template: '{"chatInput": "{{ input }}"}',
          input: inputWith("a\tb\rc"),
        });

        expect(JSON.parse(body).chatInput).toBe("a\tb\rc");
      });
    });
  });

  describe("given the pre-serialized conversation history", () => {
    /** @scenario Pre-serialized conversation history is still injected as raw JSON */
    it("injects {{messages}} as a raw JSON array, not an escaped string", () => {
      const input = inputWith("hello");
      input.messages = [
        { role: "user", content: "first\nturn" },
        { role: "assistant", content: 'reply with "quotes"' },
      ];

      const body = render({ template: '{"messages": {{messages}}}', input });

      const parsed = JSON.parse(body);
      expect(Array.isArray(parsed.messages)).toBe(true);
      expect(parsed.messages).toEqual(input.messages);
    });

    /** @scenario The default body template survives an awkward conversation */
    it("keeps the default threadId+messages template valid for awkward turns", () => {
      const input = inputWith("hi");
      input.messages = [
        { role: "user", content: 'multi\nline "quoted" \\slash' },
      ];

      const body = render({
        template:
          '{\n  "thread_id": "{{threadId}}",\n  "messages": {{messages}}\n}',
        input,
      });

      const parsed = JSON.parse(body);
      expect(parsed.thread_id).toBe("thread-1");
      expect(parsed.messages).toEqual(input.messages);
    });
  });

  describe("given structured (non-string) message content", () => {
    it('still injects {{input}} raw so {"input": {{input}}} stays valid', () => {
      const structured = [{ type: "text", text: "Hello world" }];
      const body = render({
        template: '{"input": {{input}}}',
        input: inputWith(structured),
      });

      expect(JSON.parse(body).input).toEqual(structured);
    });
  });

  describe("given the raw filter", () => {
    /** @scenario A user can opt a scalar out of escaping with the raw filter */
    it("opts a scalar out of JSON escaping", () => {
      const body = render({
        template: '{"passthrough": {{ input | raw }}}',
        input: inputWith('{"a":1}'),
      });

      expect(JSON.parse(body).passthrough).toEqual({ a: 1 });
    });
  });

  describe("given scenario mappings", () => {
    /** @scenario Mapped scenario fields routed to a string slot are escaped */
    it("escapes a field mapped to the scenario input", () => {
      const body = render({
        template: '{"q": "{{query}}"}',
        input: inputWith("has a\nnewline"),
        scenarioMappings: {
          query: { type: "source", sourceId: "scenario", path: ["input"] },
        },
      });

      expect(JSON.parse(body).q).toBe("has a\nnewline");
    });

    it("injects a field mapped to messages as raw JSON", () => {
      const input = inputWith("hi");
      input.messages = [{ role: "user", content: "line\nbreak" }];

      const body = render({
        template: '{"history": {{context}}}',
        input,
        scenarioMappings: {
          context: { type: "source", sourceId: "scenario", path: ["messages"] },
        },
      });

      expect(JSON.parse(body).history).toEqual(input.messages);
    });

    it("escapes a static value mapping containing control characters", () => {
      const body = render({
        template: '{"sys": "{{ctx}}"}',
        input: inputWith("hi"),
        scenarioMappings: {
          ctx: { type: "value", value: 'line\nwith "quote"' },
        },
      });

      expect(JSON.parse(body).sys).toBe('line\nwith "quote"');
    });
  });
});

describe("run parameters in the template context", () => {
  describe("given a run that resolved values", () => {
    /** @scenario "An http target reads params in its url and body templates" */
    it("makes each one reachable as params.NAME", () => {
      const context = buildTemplateContext({
        input: inputWith("hi"),
        parameters: { account_tier: "platinum", seats: 12 },
      });

      expect(context.params).toEqual({ account_tier: "platinum", seats: 12 });
    });

    /** @scenario "An http target reads params in its url and body templates" */
    it("renders one into a body template", () => {
      const body = renderBodyTemplate({
        template: '{"tier": "{{ params.account_tier }}"}',
        context: buildTemplateContext({
          input: inputWith("hi"),
          parameters: { account_tier: "platinum" },
        }),
      });

      expect(JSON.parse(body).tier).toBe("platinum");
    });

    it("leaves the conversation bindings alone", () => {
      const context = buildTemplateContext({
        input: inputWith("hi"),
        parameters: { input: "not the conversation", threadId: "not-the-id" },
      });

      expect(context.input).toBe("hi");
      expect(context.threadId).toBe("thread-1");
      expect(String(context.messages)).toContain("hi");
    });
  });

  describe("given a run that resolved none", () => {
    it("binds an empty namespace rather than nothing", () => {
      const context = buildTemplateContext({ input: inputWith("hi") });

      expect(context.params).toEqual({});
    });
  });

  describe("given a data mapping already named params", () => {
    it("keeps the mapping, so an existing target is unchanged", () => {
      const context = buildTemplateContext({
        input: inputWith("hi"),
        parameters: { account_tier: "platinum" },
        scenarioMappings: {
          params: { type: "value", value: "the mapping wins" },
        },
      });

      expect(context.params).toBe("the mapping wins");
    });
  });
});
