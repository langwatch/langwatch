import { describe, expect, it } from "vitest";
import {
  spanTypes,
  SpanType,
  LangWatchSpanRAGContext,
  LangWatchSpanMetrics,
  LangWatchSpanOptions,
  JsonSerializable,
} from "../types";

describe("spanTypes", () => {
  it("should include all expected span types", () => {
    const expectedTypes = [
      "span",
      "llm",
      "chain",
      "tool",
      "agent",
      "guardrail",
      "evaluation",
      "rag",
      "prompt",
      "workflow",
      "component",
      "module",
      "server",
      "client",
      "producer",
      "consumer",
      "task",
      "unknown",
    ];

    expect(spanTypes).toEqual(expectedTypes);
  });

  it("should be a readonly array", () => {
    // This test ensures the type system enforces readonly behavior
    const types: readonly string[] = spanTypes;
    expect(types).toBe(spanTypes);
  });

  it("should have correct length", () => {
    expect(spanTypes).toHaveLength(18);
  });
});

describe("SpanType", () => {
  it("should accept valid span types", () => {
    const validTypes: SpanType[] = [
      "span",
      "llm",
      "chain",
      "tool",
      "agent",
      "guardrail",
      "evaluation",
      "rag",
      "prompt",
      "workflow",
      "component",
      "module",
      "server",
      "client",
      "producer",
      "consumer",
      "task",
      "unknown",
    ];

    validTypes.forEach(type => {
      expect(spanTypes).toContain(type);
    });
  });
});

describe("JsonSerializable", () => {
  it("should accept primitive types", () => {
    const stringValue: JsonSerializable = "test";
    const numberValue: JsonSerializable = 42;
    const booleanValue: JsonSerializable = true;
    const nullValue: JsonSerializable = null;

    expect(typeof stringValue).toBe("string");
    expect(typeof numberValue).toBe("number");
    expect(typeof booleanValue).toBe("boolean");
    expect(nullValue).toBe(null);
  });

  it("should accept arrays", () => {
    const arrayValue: JsonSerializable = ["test", 42, true, null];
    expect(Array.isArray(arrayValue)).toBe(true);
  });

  it("should accept objects", () => {
    const objectValue: JsonSerializable = {
      string: "test",
      number: 42,
      boolean: true,
      nullValue: null,
      array: [1, 2, 3],
      nested: {
        key: "value"
      }
    };

    expect(typeof objectValue).toBe("object");
    expect(objectValue).not.toBe(null);
  });

  it("should accept nested structures", () => {
    const complexValue: JsonSerializable = {
      users: [
        { id: 1, name: "Alice", active: true },
        { id: 2, name: "Bob", active: false }
      ],
      metadata: {
        count: 2,
        tags: ["user", "management"],
        config: null
      }
    };

    expect(typeof complexValue).toBe("object");
  });
});

describe("LangWatchSpanRAGContext", () => {
  it("should accept valid RAG context", () => {
    const ragContext: LangWatchSpanRAGContext = {
      document_id: "doc-123",
      chunk_id: "chunk-456",
      content: "Relevant passage from the document."
    };

    expect(ragContext.document_id).toBe("doc-123");
    expect(ragContext.chunk_id).toBe("chunk-456");
    expect(ragContext.content).toBe("Relevant passage from the document.");
  });

  it("should require all fields", () => {
    // This test verifies the TypeScript interface requirements
    const ragContext: LangWatchSpanRAGContext = {
      document_id: "",
      chunk_id: "",
      content: ""
    };

    expect(ragContext).toHaveProperty("document_id");
    expect(ragContext).toHaveProperty("chunk_id");
    expect(ragContext).toHaveProperty("content");
  });

  it("should accept string values", () => {
    const ragContext: LangWatchSpanRAGContext = {
      document_id: "document-with-special-chars-123!@#",
      chunk_id: "chunk_with_underscores_456",
      content: "Multi-line content\nwith special characters: éñüíóá"
    };

    expect(typeof ragContext.document_id).toBe("string");
    expect(typeof ragContext.chunk_id).toBe("string");
    expect(typeof ragContext.content).toBe("string");
  });
});

describe("LangWatchSpanMetrics", () => {
  it("should accept all optional metrics", () => {
    const metrics: LangWatchSpanMetrics = {
      promptTokens: 100,
      completionTokens: 50,
      cost: 0.002
    };

    expect(metrics.promptTokens).toBe(100);
    expect(metrics.completionTokens).toBe(50);
    expect(metrics.cost).toBe(0.002);
  });

  it("should accept partial metrics", () => {
    const metrics1: LangWatchSpanMetrics = {
      promptTokens: 100
    };

    const metrics2: LangWatchSpanMetrics = {
      cost: 0.001
    };

    const metrics3: LangWatchSpanMetrics = {
      completionTokens: 25
    };

    expect(metrics1.promptTokens).toBe(100);
    expect(metrics1.completionTokens).toBeUndefined();
    expect(metrics1.cost).toBeUndefined();

    expect(metrics2.cost).toBe(0.001);
    expect(metrics2.promptTokens).toBeUndefined();
    expect(metrics2.completionTokens).toBeUndefined();

    expect(metrics3.completionTokens).toBe(25);
    expect(metrics3.promptTokens).toBeUndefined();
    expect(metrics3.cost).toBeUndefined();
  });

  it("should accept empty metrics object", () => {
    const metrics: LangWatchSpanMetrics = {};

    expect(metrics.promptTokens).toBeUndefined();
    expect(metrics.completionTokens).toBeUndefined();
    expect(metrics.cost).toBeUndefined();
  });

  it("should accept zero values", () => {
    const metrics: LangWatchSpanMetrics = {
      promptTokens: 0,
      completionTokens: 0,
      cost: 0
    };

    expect(metrics.promptTokens).toBe(0);
    expect(metrics.completionTokens).toBe(0);
    expect(metrics.cost).toBe(0);
  });

  it("should accept decimal values", () => {
    const metrics: LangWatchSpanMetrics = {
      promptTokens: 123.45, // Even though typically integers, type allows numbers
      completionTokens: 67.89,
      cost: 0.00123456
    };

    expect(metrics.promptTokens).toBe(123.45);
    expect(metrics.completionTokens).toBe(67.89);
    expect(metrics.cost).toBe(0.00123456);
  });
});

describe("LangWatchSpanOptions", () => {
  it("should extend SpanOptions", () => {
    // Test that LangWatchSpanOptions can include standard OpenTelemetry SpanOptions
    const options: LangWatchSpanOptions = {
      kind: 1, // SpanKind.CLIENT from OpenTelemetry
      startTime: [1234567890, 123456789], // HrTime format
      attributes: {
        "langwatch.span.type": "llm",
        "gen_ai.request.model": "gpt-4"
      }
    };

    expect(options.kind).toBe(1);
    expect(options.startTime).toEqual([1234567890, 123456789]);
    expect(options.attributes).toBeDefined();
  });

  it("should accept custom attributes", () => {
    const options: LangWatchSpanOptions = {
      attributes: {
        "custom.attribute": "value",
        "langwatch.span.type": "chain",
        "gen_ai.request.model": "claude-3"
      }
    };

    expect(options.attributes).toHaveProperty("custom.attribute");
    expect(options.attributes).toHaveProperty("langwatch.span.type");
    expect(options.attributes).toHaveProperty("gen_ai.request.model");
  });

  it("should accept empty options", () => {
    const options: LangWatchSpanOptions = {};

    expect(options.attributes).toBeUndefined();
  });

  it("should accept undefined attributes", () => {
    const options: LangWatchSpanOptions = {
      attributes: undefined
    };

    expect(options.attributes).toBeUndefined();
  });
});
