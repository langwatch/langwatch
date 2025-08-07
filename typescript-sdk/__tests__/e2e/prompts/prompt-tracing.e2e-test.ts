import { describe, expect, it, beforeAll, beforeEach } from "vitest";
import { getLangwatchSDK } from "../../helpers/get-sdk.js";
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

import { ATTR_LANGWATCH_SPAN_TYPE } from "../../../src/observability/semconv";

describe("Prompt tracing", () => {
  let langwatch: typeof import("../../../dist/index.js");

  beforeAll(async () => {
    langwatch = await getLangwatchSDK();
  });

  describe("get tracing", () => {
    let spans: ReadableSpan[];
    let getSpan: ReadableSpan | undefined;

    beforeEach(async () => {
      // Clear any previous spans
      spanExporter.reset();

      // Test template compilation
      const prompt = await langwatch.prompts.get("prompt_123");
      prompt.compile({
        name: "Alice",
        topic: "weather",
      });
      spans = spanExporter.getFinishedSpans();
      getSpan = spans.find((span) => span.name === "retrieve prompt");
    });

    it("should create a span with correct name", () => {
      expect(getSpan).toBeDefined();
    });

    it("should set span type to 'prompt'", () => {
      expect(getSpan?.attributes[ATTR_LANGWATCH_SPAN_TYPE]).toBe("prompt");
    });

    it("should set prompt metadata attributes", () => {
      expect(getSpan?.attributes["langwatch.prompt.id"]).toBe("prompt_123");
      expect(getSpan?.attributes["langwatch.prompt.version.id"]).toBe(
        "prompt_version_3",
      );
      expect(getSpan?.attributes["langwatch.prompt.version.number"]).toBe(1);
    });

    it("should set output data", () => {
      // Check that output was set (it should be JSON stringified)
      expect(getSpan?.attributes["langwatch.output"]).toBeDefined();

      const outputAttr = getSpan?.attributes["langwatch.output"] as string;
      const output = JSON.parse(outputAttr);

      // Verify the prompt response structure is captured
      expect(output.value.id).toBe("prompt_123");
      expect(output.value.handle).toBe("test-prompt-4");
      expect(output.value.name).toBe("Test Prompt 4");
      expect(output.value.scope).toBe("ORGANIZATION");
      expect(output.value.version).toBe(1);
    });
  });

  describe("compilation", () => {
    let spans: ReadableSpan[];
    let compileSpan: ReadableSpan | undefined;

    beforeEach(async () => {
      // Clear any previous spans
      spanExporter.reset();

      // Test template compilation
      const prompt = await langwatch.prompts.get("prompt_123");
      prompt.compile({
        name: "Alice",
        topic: "weather",
      });
      spans = spanExporter.getFinishedSpans();
      compileSpan = spans.find((span) => span.name === "compile");
    });

    it("should create a span with correct name", () => {
      expect(compileSpan).toBeDefined();
    });

    it("should set span type to 'prompt'", () => {
      expect(compileSpan?.attributes[ATTR_LANGWATCH_SPAN_TYPE]).toBe("prompt");
    });

    it("should set prompt metadata attributes", () => {
      expect(compileSpan?.attributes["langwatch.prompt.id"]).toBe("prompt_123");
      expect(compileSpan?.attributes["langwatch.prompt.version.id"]).toBe(
        "prompt_version_7",
      );
      expect(compileSpan?.attributes["langwatch.prompt.version.number"]).toBe(
        1,
      );
    });

    it("should set output data", () => {
      // Check that output was set (it should be JSON stringified)
      expect(compileSpan?.attributes["langwatch.output"]).toBeDefined();

      const outputAttr = compileSpan?.attributes["langwatch.output"] as string;
      const output = JSON.parse(outputAttr);

      expect(output.value.prompt).toBe(
        "Hello Alice, how is the weather today?",
      );
      expect(output.value.messages[1].content).toBe("Tell me about weather");
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
          name: "Alice",
          topic: "weather",
        },
      ]);
    });
  });
});
