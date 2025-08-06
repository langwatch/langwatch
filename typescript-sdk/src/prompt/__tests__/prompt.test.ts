import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  NodeTracerProvider,
  ReadableSpan,
} from "@opentelemetry/sdk-trace-node";

// Set up tracing BEFORE importing the modules that use tracers
let spanExporter: InMemorySpanExporter;
let tracerProvider: NodeTracerProvider;

spanExporter = new InMemorySpanExporter();
tracerProvider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(spanExporter)],
});
tracerProvider.register();

import { ATTR_LANGWATCH_SPAN_TYPE } from "../../observability/semconv";
import { Prompt, PromptCompilationError, CompiledPrompt } from "../prompt";

describe("Prompt", () => {
  beforeEach(() => {
    // Clear any previous spans
    spanExporter.reset();
  });

  afterEach(() => {
    // Clean up spans after each test
    spanExporter.reset();
  });

  // Clean up the tracer provider after all tests
  afterAll(() => {
    tracerProvider.shutdown();
  });

  const mockPromptData = {
    id: "prompt_123",
    handle: null,
    scope: "PROJECT" as const,
    name: "Test Prompt",
    updatedAt: "2024-01-01T00:00:00Z",
    version: 1,
    versionId: "version_123",
    versionCreatedAt: "2024-01-01T00:00:00Z",
    model: "gpt-4",
    prompt: "Hello {{user_name}}, how is the {{topic}} today?",
    messages: [
      {
        role: "user" as const,
        content: "Tell me about {{topic}}",
      },
    ],
    response_format: null,
  };

  describe("#compile", () => {
    const prompt = new Prompt(mockPromptData);
    let result: CompiledPrompt;
    let spans: ReadableSpan[];
    let compileSpan: ReadableSpan | undefined;

    beforeEach(async () => {
      // Clear any previous spans
      spanExporter.reset();

      // Test template compilation
      result = prompt.compile({
        user_name: "Alice",
        topic: "weather",
      });
      spans = spanExporter.getFinishedSpans();
      compileSpan = spans.find((span) => span.name === "compile");
    });

    it("should compile a prompt", () => {
      expect(result.prompt).toBe("Hello Alice, how is the weather today?");
    });

    it("should compile the messages", () => {
      expect(result.messages[0]?.content).toBe("Tell me about weather");
    });

    describe("tracing", () => {
      it("should create a span with correct name", () => {
        expect(compileSpan).toBeDefined();
      });

      it("should set span type to 'prompt'", () => {
        expect(compileSpan?.attributes[ATTR_LANGWATCH_SPAN_TYPE]).toBe(
          "prompt",
        );
      });

      it("should set prompt metadata attributes", () => {
        expect(compileSpan?.attributes["langwatch.prompt.id"]).toBe(
          "prompt_123",
        );
        expect(compileSpan?.attributes["langwatch.prompt.version.id"]).toBe(
          "version_123",
        );
        expect(compileSpan?.attributes["langwatch.prompt.version.number"]).toBe(
          1,
        );
      });

      it("should set output data", () => {
        // Check that output was set (it should be JSON stringified)
        expect(compileSpan?.attributes["langwatch.output"]).toBeDefined();

        const outputAttr = compileSpan?.attributes[
          "langwatch.output"
        ] as string;
        const output = JSON.parse(outputAttr);

        expect(output.value.prompt).toBe(
          "Hello Alice, how is the weather today?",
        );
        expect(output.value.messages[0].content).toBe("Tell me about weather");
      });

      it("should set input variables", () => {
        // Check that input variables were captured
        expect(
          compileSpan?.attributes["langwatch.prompt.variables"],
        ).toBeDefined();

        const variablesAttr = compileSpan?.attributes[
          "langwatch.prompt.variables"
        ] as string;
        const variables = JSON.parse(variablesAttr);

        expect(variables.value).toEqual([
          {
            user_name: "Alice",
            topic: "weather",
          },
        ]);
      });
    });
  });

  describe("#compileStrict", () => {
    const prompt = new Prompt(mockPromptData);
    let result: CompiledPrompt;
    let spans: ReadableSpan[];
    let compileSpan: ReadableSpan | undefined;

    beforeEach(async () => {
      // Clear any previous spans
      spanExporter.reset();

      // Test template compilation
      result = prompt.compile({
        user_name: "Alice",
        topic: "weather",
      });
      spans = spanExporter.getFinishedSpans();
      compileSpan = spans.find((span) => span.name === "compile");
    });

    it("should compile a prompt", () => {
      expect(result.prompt).toBe("Hello Alice, how is the weather today?");
    });

    it("should compile the messages", () => {
      expect(result.messages[0]?.content).toBe("Tell me about weather");
    });

    it("should throw on strict compilation with missing variables", () => {
      expect(() => {
        prompt.compileStrict({});
      }).toThrow(PromptCompilationError);
    });

    describe("tracing", () => {
      it("should still create a span even when throwing", () => {
        expect(() => {
          prompt.compileStrict({});
        }).toThrow(PromptCompilationError);

        expect(compileSpan).toBeDefined();
        expect(compileSpan?.attributes[ATTR_LANGWATCH_SPAN_TYPE]).toBe(
          "prompt",
        );
      });

      it("should mark span as error when throwing", () => {
        expect(() => {
          prompt.compileStrict({});
        }).toThrow(PromptCompilationError);

        const spans = spanExporter.getFinishedSpans();
        const compileStrictSpan = spans.find(
          (span) => span.name === "compileStrict",
        );

        // Check that the span was marked as an error
        expect(compileStrictSpan?.status?.code).toBe(2); // ERROR status code
      });
    });
  });
});
