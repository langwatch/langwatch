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

import { AgentRole, type AgentInput } from "@langwatch/scenario";
import { describe, expect, it } from "vitest";
import {
  buildTemplateContext,
  renderBodyTemplate,
} from "../http-template-engine";
import type { FieldMapping } from "../types";

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

function render(
  template: string,
  input: AgentInput,
  scenarioMappings?: Record<string, FieldMapping>,
): string {
  return renderBodyTemplate({
    template,
    context: buildTemplateContext({ input, scenarioMappings }),
  });
}

describe("body template JSON safety", () => {
  describe("given a scalar value interpolated inside a JSON string literal", () => {
    describe("when the value contains a newline", () => {
      it("escapes it so the body is valid JSON", () => {
        const body = render(
          '{"chatInput": "{{ input }}"}',
          inputWith("line one\nline two"),
        );

        expect(() => JSON.parse(body)).not.toThrow();
        expect(JSON.parse(body).chatInput).toBe("line one\nline two");
      });
    });

    describe("when the value contains a double quote", () => {
      it("escapes it so the body is valid JSON", () => {
        const body = render(
          '{"chatInput": "{{ input }}"}',
          inputWith('she said "hi"'),
        );

        expect(JSON.parse(body).chatInput).toBe('she said "hi"');
      });
    });

    describe("when the value contains a backslash", () => {
      it("escapes it so the body is valid JSON", () => {
        const body = render(
          '{"chatInput": "{{ input }}"}',
          inputWith("path C:\\temp\\new"),
        );

        expect(JSON.parse(body).chatInput).toBe("path C:\\temp\\new");
      });
    });

    describe("when the value contains a tab and a carriage return", () => {
      it("escapes both control characters", () => {
        const body = render(
          '{"chatInput": "{{ input }}"}',
          inputWith("a\tb\rc"),
        );

        expect(JSON.parse(body).chatInput).toBe("a\tb\rc");
      });
    });
  });

  describe("given the pre-serialized conversation history", () => {
    it("injects {{messages}} as a raw JSON array, not an escaped string", () => {
      const input = inputWith("hello");
      input.messages = [
        { role: "user", content: "first\nturn" },
        { role: "assistant", content: 'reply with "quotes"' },
      ];

      const body = render('{"messages": {{messages}}}', input);

      const parsed = JSON.parse(body);
      expect(Array.isArray(parsed.messages)).toBe(true);
      expect(parsed.messages).toEqual(input.messages);
    });

    it("keeps the default threadId+messages template valid for awkward turns", () => {
      const input = inputWith("hi");
      input.messages = [
        { role: "user", content: 'multi\nline "quoted" \\slash' },
      ];

      const body = render(
        '{\n  "thread_id": "{{threadId}}",\n  "messages": {{messages}}\n}',
        input,
      );

      const parsed = JSON.parse(body);
      expect(parsed.thread_id).toBe("thread-1");
      expect(parsed.messages).toEqual(input.messages);
    });
  });

  describe("given structured (non-string) message content", () => {
    it("still injects {{input}} raw so {\"input\": {{input}}} stays valid", () => {
      const structured = [{ type: "text", text: "Hello world" }];
      const body = render('{"input": {{input}}}', inputWith(structured));

      expect(JSON.parse(body).input).toEqual(structured);
    });
  });

  describe("given the raw filter", () => {
    it("opts a scalar out of JSON escaping", () => {
      const body = render('{"passthrough": {{ input | raw }}}', inputWith('{"a":1}'));

      expect(JSON.parse(body).passthrough).toEqual({ a: 1 });
    });
  });

  describe("given scenario mappings", () => {
    it("escapes a field mapped to the scenario input", () => {
      const body = render(
        '{"q": "{{query}}"}',
        inputWith("has a\nnewline"),
        { query: { type: "source", sourceId: "scenario", path: ["input"] } },
      );

      expect(JSON.parse(body).q).toBe("has a\nnewline");
    });

    it("injects a field mapped to messages as raw JSON", () => {
      const input = inputWith("hi");
      input.messages = [{ role: "user", content: "line\nbreak" }];

      const body = render(
        '{"history": {{context}}}',
        input,
        { context: { type: "source", sourceId: "scenario", path: ["messages"] } },
      );

      expect(JSON.parse(body).history).toEqual(input.messages);
    });

    it("escapes a static value mapping containing control characters", () => {
      const body = render(
        '{"sys": "{{ctx}}"}',
        inputWith("hi"),
        { ctx: { type: "value", value: 'line\nwith "quote"' } },
      );

      expect(JSON.parse(body).sys).toBe('line\nwith "quote"');
    });
  });
});
