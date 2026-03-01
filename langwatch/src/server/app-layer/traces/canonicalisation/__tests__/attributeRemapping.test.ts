import { describe, expect, it } from "vitest";
import type { NormalizedSpan } from "../../../../event-sourcing/pipelines/trace-processing/schemas/spans";
import { CanonicalizeSpanAttributesService } from "../canonicalizeSpanAttributesService";

const service = new CanonicalizeSpanAttributesService();

const stubSpan: Pick<
  NormalizedSpan,
  "name" | "kind" | "instrumentationScope" | "statusMessage" | "statusCode"
> = {
  name: "test",
  kind: "CLIENT",
  instrumentationScope: { name: "test", version: "1.0" },
  statusMessage: null,
  statusCode: null,
} as any;

describe("CanonicalizeSpanAttributesService — take vs preserve semantics", () => {
  describe("when attributes are taken (consumed)", () => {
    it("removes gen_ai.prompt from output after mapping to gen_ai.input.messages", () => {
      const result = service.canonicalize(
        { "gen_ai.prompt": "Hello world" },
        [],
        stubSpan as any,
      );

      // gen_ai.prompt is taken by GenAIExtractor → should not appear in output
      expect(result.attributes["gen_ai.prompt"]).toBeUndefined();
      // It should have been mapped to gen_ai.input.messages
      expect(result.attributes["gen_ai.input.messages"]).toBeDefined();
    });

    it("removes gen_ai.completion from output after mapping to gen_ai.output.messages", () => {
      const result = service.canonicalize(
        { "gen_ai.completion": "The answer is 42" },
        [],
        stubSpan as any,
      );

      expect(result.attributes["gen_ai.completion"]).toBeUndefined();
      expect(result.attributes["gen_ai.output.messages"]).toBeDefined();
    });

    it("removes llm.input_messages from output after mapping", () => {
      const messages = JSON.stringify([
        { role: "user", content: "Hello from OpenLLMetry" },
      ]);
      const result = service.canonicalize(
        { "llm.input_messages": messages },
        [],
        stubSpan as any,
      );

      expect(result.attributes["llm.input_messages"]).toBeUndefined();
      expect(result.attributes["gen_ai.input.messages"]).toBeDefined();
    });

    it("removes llm.output_messages from output after mapping", () => {
      const messages = JSON.stringify([
        { role: "assistant", content: "Response" },
      ]);
      const result = service.canonicalize(
        { "llm.output_messages": messages },
        [],
        stubSpan as any,
      );

      expect(result.attributes["llm.output_messages"]).toBeUndefined();
      expect(result.attributes["gen_ai.output.messages"]).toBeDefined();
    });

    it("removes traceloop.entity.input from output after mapping", () => {
      const input = JSON.stringify({ role: "user", content: "Traceloop input" });
      const result = service.canonicalize(
        { "traceloop.entity.input": input },
        [],
        stubSpan as any,
      );

      expect(result.attributes["traceloop.entity.input"]).toBeUndefined();
      expect(result.attributes["gen_ai.input.messages"]).toBeDefined();
    });

    it("removes langwatch.thread.id from output after mapping to gen_ai.conversation.id", () => {
      const result = service.canonicalize(
        { "langwatch.thread.id": "thread-123" },
        [],
        stubSpan as any,
      );

      expect(result.attributes["langwatch.thread.id"]).toBeUndefined();
      expect(result.attributes["gen_ai.conversation.id"]).toBe("thread-123");
    });

    it("removes langwatch.input from bag then re-sets in canonical output", () => {
      const result = service.canonicalize(
        { "langwatch.input": "some raw input" },
        [],
        stubSpan as any,
      );

      // langwatch.input is taken then re-set via setAttr
      // The final output should contain the canonical form
      expect(result.attributes["langwatch.input"]).toBe("some raw input");
    });

    it("removes ai.prompt from output after mapping", () => {
      const result = service.canonicalize(
        { "ai.prompt": JSON.stringify("A vercel prompt") },
        [],
        // Vercel extractor requires instrumentationScope.name === "ai"
        {
          name: "ai.generateText",
          kind: "CLIENT",
          instrumentationScope: { name: "ai", version: "3.0" },
          statusMessage: null,
          statusCode: null,
        } as any,
      );

      expect(result.attributes["ai.prompt"]).toBeUndefined();
      expect(result.attributes["gen_ai.input.messages"]).toBeDefined();
    });
  });

  describe("when metadata is consumed and hoisted (take)", () => {
    it("consumes metadata blob and hoists fields to canonical keys", () => {
      const metadata = JSON.stringify({
        user_id: "u1",
        custom_field: "still here",
      });
      const result = service.canonicalize(
        { metadata },
        [],
        stubSpan as any,
      );

      // metadata is consumed via take(), so raw blob is gone
      expect(result.attributes["metadata"]).toBeUndefined();
      // Reserved fields are promoted to canonical keys
      expect(result.attributes["langwatch.user.id"]).toBe("u1");
      // Custom fields are hoisted as metadata.{key}
      expect(result.attributes["metadata.custom_field"]).toBe("still here");
    });

    it("preserves langwatch.span.type when read for detection", () => {
      const result = service.canonicalize(
        { "langwatch.span.type": "llm" },
        [],
        stubSpan as any,
      );

      // langwatch.span.type is read with get() by LangWatch extractor
      // then written to out via setAttr, so it appears in final output
      expect(result.attributes["langwatch.span.type"]).toBe("llm");
    });
  });

  describe("when canonical key collides with original key", () => {
    it("canonical output wins over remaining original (out spread last)", () => {
      // gen_ai.input.messages is both an original key in the bag AND
      // could be set to out by GenAI extractor's system instruction extraction.
      // The merge is { ...remaining(), ...out }, so out wins.
      const originalMessages = JSON.stringify([
        { role: "system", content: "Be helpful." },
        { role: "user", content: "Hi" },
      ]);

      const result = service.canonicalize(
        {
          "gen_ai.input.messages": originalMessages,
        },
        [],
        stubSpan as any,
      );

      // gen_ai.input.messages stays in the bag (it's not taken by anyone when already present)
      // But system_instruction should be extracted from it
      expect(result.attributes["gen_ai.request.system_instruction"]).toBe(
        "Be helpful.",
      );
    });
  });

  describe("when langwatch.input is taken and re-set", () => {
    it("take removes from bag, setAttr re-adds to out, final has canonical form", () => {
      const structuredInput = JSON.stringify({
        type: "chat_messages",
        value: [{ role: "user", content: "Hi" }],
      });

      const result = service.canonicalize(
        { "langwatch.input": structuredInput },
        [],
        stubSpan as any,
      );

      // langwatch.input is taken from bag (removing from remaining)
      // then re-set in out with the raw wrapper string
      // Since out is spread last, canonical form wins
      expect(result.attributes["langwatch.input"]).toEqual({
        type: "chat_messages",
        value: [{ role: "user", content: "Hi" }],
      });

      // Also gen_ai.input.messages should be set from the structured value
      expect(result.attributes["gen_ai.input.messages"]).toBeDefined();
    });
  });

  describe("when unknown attributes are present", () => {
    it("passes through unknown attributes in remaining()", () => {
      const result = service.canonicalize(
        {
          "my.custom.attribute": "custom-value",
          "another.unknown": "data",
        },
        [],
        stubSpan as any,
      );

      // Unknown attributes are not consumed by any extractor
      // They remain in the bag and appear via remaining()
      expect(result.attributes["my.custom.attribute"]).toBe("custom-value");
      expect(result.attributes["another.unknown"]).toBe("data");
    });

    it("does not lose attributes that no extractor handles", () => {
      const result = service.canonicalize(
        {
          "gen_ai.prompt": "Hello",
          "my.app.version": "2.0",
          "custom.trace.tag": "experiment-42",
        },
        [],
        stubSpan as any,
      );

      // gen_ai.prompt is consumed and mapped
      expect(result.attributes["gen_ai.prompt"]).toBeUndefined();
      expect(result.attributes["gen_ai.input.messages"]).toBeDefined();

      // Custom attributes survive
      expect(result.attributes["my.app.version"]).toBe("2.0");
      expect(result.attributes["custom.trace.tag"]).toBe("experiment-42");
    });
  });
});
