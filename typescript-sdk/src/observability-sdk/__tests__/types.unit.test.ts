import { describe, it, expect } from "vitest";
import {
  spanTypes,
  SpanType,
  LangWatchSpanRAGContext,
  LangWatchSpanMetrics,
  LangWatchSpanGenAISystemMessageEventBody,
  LangWatchSpanGenAIUserMessageEventBody,
  LangWatchSpanGenAIAssistantMessageEventBody,
} from "../types";

describe("types.ts", () => {
  describe("spanTypes constant", () => {
    it("should contain all expected span types", () => {
      const expectedTypes = [
        "span","llm","chain","tool","agent","guardrail","evaluation","rag",
        "prompt","workflow","component","module","server","client",
        "producer","consumer","task","unknown"
      ];
      expect(spanTypes).toEqual(expectedTypes);
      expect(spanTypes).toHaveLength(expectedTypes.length);
    });

    it("should contain unique values", () => {
      const uniqueTypes = [...new Set(spanTypes)];
      expect(uniqueTypes).toHaveLength(spanTypes.length);
    });
  });

  describe("SpanType union type", () => {
    it("should be compatible with spanTypes array elements", () => {
      spanTypes.forEach(type => {
        const typedVar: SpanType = type;
        expect(typeof typedVar).toBe("string");
      });
    });
  });

  describe("Type compatibility and integration", () => {
    it("should allow using types together in realistic scenarios", () => {
      const spanType: SpanType = "llm";
      const ragContext: LangWatchSpanRAGContext = {
        document_id: "doc-1",
        chunk_id: "chunk-1",
        content: "Retrieved context",
      };
      const metrics: LangWatchSpanMetrics = {
        promptTokens: 100,
        completionTokens: 50,
        cost: 0.001,
      };
      const systemMessage: LangWatchSpanGenAISystemMessageEventBody = {
        content: "You are a helpful assistant.",
        role: "system",
      };
      const userMessage: LangWatchSpanGenAIUserMessageEventBody = {
        content: "Hello, world!",
        role: "user",
      };
      const assistantMessage: LangWatchSpanGenAIAssistantMessageEventBody = {
        content: "Hello! How can I help you?",
        role: "assistant",
      };
      expect(spanType).toBe("llm");
      expect(ragContext.document_id).toBe("doc-1");
      expect(metrics.promptTokens).toBe(100);
      expect(systemMessage.content).toBe("You are a helpful assistant.");
      expect(userMessage.content).toBe("Hello, world!");
      expect(assistantMessage.content).toBe("Hello! How can I help you?");
    });
  });
});
