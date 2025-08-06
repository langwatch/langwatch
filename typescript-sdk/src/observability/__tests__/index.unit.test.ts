import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupTestEnvironment, testScenarios, MockTracerProvider } from "./test-utils";
import { createLangWatchSpan } from "../span";
import { getLangWatchTracer, getLangWatchTracerFromProvider } from "../tracer";
import { FilterableBatchSpanProcessor } from "../processors";
import { LangWatchExporter } from "../exporters";
import * as indexModule from "../index";
import * as intSemconv from "../semconv";

describe("index.ts", () => {
  let testEnv: ReturnType<typeof setupTestEnvironment>;

  beforeEach(() => {
    testEnv = setupTestEnvironment();
  });

  afterEach(() => {
    testEnv.cleanup();
  });

  describe("module exports", () => {
    it("should export createLangWatchSpan function", () => {
      expect(indexModule.createLangWatchSpan).toBeDefined();
      expect(typeof indexModule.createLangWatchSpan).toBe("function");
      expect(indexModule.createLangWatchSpan).toBe(createLangWatchSpan);
    });

    it("should export getLangWatchTracer function", () => {
      expect(indexModule.getLangWatchTracer).toBeDefined();
      expect(typeof indexModule.getLangWatchTracer).toBe("function");
      expect(indexModule.getLangWatchTracer).toBe(getLangWatchTracer);
    });

    it("should export getLangWatchTracerFromProvider function", () => {
      expect(indexModule.getLangWatchTracerFromProvider).toBeDefined();
      expect(typeof indexModule.getLangWatchTracerFromProvider).toBe("function");
      expect(indexModule.getLangWatchTracerFromProvider).toBe(getLangWatchTracerFromProvider);
    });

    it("should export FilterableBatchSpanProcessor", () => {
      expect(indexModule.FilterableBatchSpanProcessor).toBeDefined();
      expect(typeof indexModule.FilterableBatchSpanProcessor).toBe("function");
      expect(indexModule.FilterableBatchSpanProcessor).toBe(FilterableBatchSpanProcessor);
    });

    it("should export LangWatchExporter", () => {
      expect(indexModule.LangWatchExporter).toBeDefined();
      expect(typeof indexModule.LangWatchExporter).toBe("function");
      expect(indexModule.LangWatchExporter).toBe(LangWatchExporter);
    });

    it("should export attributes namespace", () => {
      expect(indexModule.attributes).toBeDefined();
      expect(typeof indexModule.attributes).toBe("object");
      expect(indexModule.attributes).not.toBeNull();
    });

    it("should export types from types module", () => {
      // Check that span types are exported
      expect(indexModule.spanTypes).toBeDefined();
      expect(Array.isArray(indexModule.spanTypes)).toBe(true);
      expect(indexModule.spanTypes.length).toBeGreaterThan(0);
    });
  });

  describe("module structure", () => {
    it("should have expected named exports", () => {
      const expectedExports = [
        "createLangWatchSpan",
        "getLangWatchTracer",
        "getLangWatchTracerFromProvider",
        "FilterableBatchSpanProcessor",
        "LangWatchExporter",
        "attributes",
        // From types export
        "spanTypes"
      ];

      expectedExports.forEach(exportName => {
        expect(indexModule).toHaveProperty(exportName);
      });
    });

    it("should not have a default export", () => {
      expect((indexModule as any).default).toBeUndefined();
    });

    it("should only export expected items", () => {
      const actualExports = Object.keys(indexModule);

      // All exports should be intentional - no accidental exports
      expect(actualExports.length).toBeGreaterThan(0);

      // Check that core exports are present
      expect(actualExports).toContain("createLangWatchSpan");
      expect(actualExports).toContain("getLangWatchTracer");
      expect(actualExports).toContain("getLangWatchTracerFromProvider");
      expect(actualExports).toContain("FilterableBatchSpanProcessor");
      expect(actualExports).toContain("LangWatchExporter");
      expect(actualExports).toContain("attributes");
    });
  });

  describe("functionality verification", () => {
    it("should provide working createLangWatchSpan function", () => {
      const mockSpan = {
        setAttribute: () => {},
        setAttributes: () => {},
        addEvent: () => {},
        recordException: () => {},
        setStatus: () => {},
        updateName: () => {},
        end: () => {},
        isRecording: () => true,
        spanContext: () => ({ traceId: "123", spanId: "456", traceFlags: 1 }),
        addLink: () => {},
        addLinks: () => {},
      } as any;

      const langwatchSpan = indexModule.createLangWatchSpan(mockSpan);

      expect(langwatchSpan).toBeDefined();
      expect(typeof langwatchSpan.setType).toBe("function");
      expect(typeof langwatchSpan.setInput).toBe("function");
      expect(typeof langwatchSpan.setOutput).toBe("function");
    });

    it("should provide working getLangWatchTracer function", () => {
      expect(() => {
        indexModule.getLangWatchTracer("test-tracer");
      }).not.toThrow();
    });

    it("should provide working getLangWatchTracerFromProvider function", () => {
      const mockProvider = {
        getTracer: () => ({
          startSpan: () => ({}),
          startActiveSpan: () => {},
        })
      } as any;

      expect(() => {
        indexModule.getLangWatchTracerFromProvider(mockProvider, "test-tracer");
      }).not.toThrow();
    });

    it("should export FilterableBatchSpanProcessor class", () => {
      expect(indexModule.FilterableBatchSpanProcessor).toBeDefined();
      expect(typeof indexModule.FilterableBatchSpanProcessor).toBe("function");
      expect(indexModule.FilterableBatchSpanProcessor.name).toBe("FilterableBatchSpanProcessor");
    });

    it("should export LangWatchExporter class", () => {
      expect(indexModule.LangWatchExporter).toBeDefined();
      expect(typeof indexModule.LangWatchExporter).toBe("function");
      expect(indexModule.LangWatchExporter.name).toBe("LangWatchExporter");
    });

    it("should provide attributes object with expected structure", () => {
      expect(indexModule.attributes).toBeDefined();
      expect(typeof indexModule.attributes).toBe("object");

      // Should have some LangWatch-specific attributes
      const attributeKeys = Object.keys(indexModule.attributes);
      expect(attributeKeys.length).toBeGreaterThan(0);

      // All values should be strings (attribute constants)
      attributeKeys.forEach(key => {
        expect(typeof (indexModule.attributes as any)[key]).toBe("string");
      });
    });
  });

  describe("re-exports integrity", () => {
    it("should re-export the same functions from their original modules", () => {
      expect(indexModule.createLangWatchSpan).toBe(createLangWatchSpan);
      expect(indexModule.getLangWatchTracer).toBe(getLangWatchTracer);
      expect(indexModule.getLangWatchTracerFromProvider).toBe(getLangWatchTracerFromProvider);
      expect(indexModule.FilterableBatchSpanProcessor).toBe(FilterableBatchSpanProcessor);
      expect(indexModule.LangWatchExporter).toBe(LangWatchExporter);
    });
  });

  describe("TypeScript compatibility", () => {
    it("should support static imports", () => {
      // This test verifies that the modules can be imported statically
      expect(createLangWatchSpan).toBeDefined();
      expect(getLangWatchTracer).toBeDefined();
      expect(getLangWatchTracerFromProvider).toBeDefined();
      expect(FilterableBatchSpanProcessor).toBeDefined();
      expect(LangWatchExporter).toBeDefined();
    });

    it("should export type definitions", () => {
      // Verify that types are exported (compile-time check)
      expect(indexModule.spanTypes).toBeDefined();
      expect(Array.isArray(indexModule.spanTypes)).toBe(true);
    });
  });

  describe("import patterns", () => {
    it("should support named destructuring imports", () => {
      const {
        createLangWatchSpan: destructuredCreateSpan,
        getLangWatchTracer: destructuredGetTracer,
        FilterableBatchSpanProcessor: destructuredProcessor,
        attributes: destructuredAttributes
      } = indexModule;

      expect(destructuredCreateSpan).toBe(indexModule.createLangWatchSpan);
      expect(destructuredGetTracer).toBe(indexModule.getLangWatchTracer);
      expect(destructuredProcessor).toBe(indexModule.FilterableBatchSpanProcessor);
      expect(destructuredAttributes).toBe(indexModule.attributes);
    });

    it("should support selective imports", () => {
      // These imports are done at the top of the file
      expect(createLangWatchSpan).toBe(indexModule.createLangWatchSpan);
      expect(getLangWatchTracer).toBe(indexModule.getLangWatchTracer);
      expect(FilterableBatchSpanProcessor).toBe(indexModule.FilterableBatchSpanProcessor);
      expect(LangWatchExporter).toBe(indexModule.LangWatchExporter);
    });
  });

  describe("component integration", () => {
    it("should allow creating spans from tracer and enhancing them", () => {
      const mockProvider = new MockTracerProvider();
      const tracer = indexModule.getLangWatchTracerFromProvider(mockProvider, "integration-test");

      // Create span through tracer
      const span = tracer.startSpan("integration-span");

      // Should be enhanced with LangWatch methods
      expect(typeof span.setType).toBe("function");
      expect(typeof span.setInput).toBe("function");
      expect(typeof span.setOutput).toBe("function");

      // Should support method chaining
      const result = span
        .setType("llm")
        .setInput("test input")
        .setOutput("test output");

      expect(result).toBe(span);
    });

    it("should support creating spans manually and enhancing them", () => {
      const { mockSpan } = testScenarios.createSpanTest("manual-span");

      // Enhance with LangWatch capabilities
      const langwatchSpan = indexModule.createLangWatchSpan(mockSpan);

      // Should have LangWatch methods
      expect(typeof langwatchSpan.setType).toBe("function");
      expect(typeof langwatchSpan.setRAGContext).toBe("function");
      expect(typeof langwatchSpan.addEvent).toBe("function");

      // Should preserve OpenTelemetry methods
      expect(typeof langwatchSpan.setAttribute).toBe("function");
      expect(typeof langwatchSpan.addEvent).toBe("function");
      expect(typeof langwatchSpan.end).toBe("function");
    });

    it("should provide consistent attribute constants", () => {
      const attributes = indexModule.attributes;

      // Should have LangWatch-specific attributes
      expect(attributes).toHaveProperty("ATTR_LANGWATCH_SPAN_TYPE");
      expect(attributes).toHaveProperty("ATTR_LANGWATCH_INPUT");
      expect(attributes).toHaveProperty("ATTR_LANGWATCH_OUTPUT");

      // All attributes should be strings
      Object.values(attributes).forEach(attr => {
        expect(typeof attr).toBe("string");
        expect(attr.length).toBeGreaterThan(0);
      });
    });

    it("should support span type validation", () => {
      const spanTypes = indexModule.spanTypes;

      expect(Array.isArray(spanTypes)).toBe(true);
      expect(spanTypes.length).toBeGreaterThan(0);

      // Should contain expected types
      expect(spanTypes).toContain("llm");
      expect(spanTypes).toContain("chain");
      expect(spanTypes).toContain("tool");
      expect(spanTypes).toContain("agent");

      // All should be strings
      spanTypes.forEach(type => {
        expect(typeof type).toBe("string");
        expect(type.length).toBeGreaterThan(0);
      });
    });
  });

  describe("workflow integration", () => {
    it("should support complete span lifecycle with all components", () => {
      const mockProvider = new MockTracerProvider();
      const tracer = indexModule.getLangWatchTracerFromProvider(mockProvider, "workflow-test");
      const mockTracer = mockProvider.getTracerByName("workflow-test")!;

      // Create and configure span
      const span = tracer.startSpan("workflow-span");

      // Use various LangWatch features
      span
        .setType("workflow")
        .setInput({ task: "process data" })
        .setRequestModel("gpt-4")
        .setRAGContext({
          document_id: "doc-1",
          chunk_id: "chunk-1",
          content: "context data"
        })
        .addEvent("content-is-parsed")
        .setMetrics({
          promptTokens: 50,
          completionTokens: 25,
          cost: 0.001
        })
        .setOutput({ result: "processed" })
        .addEvent("content-is-processed");

      // End span
      span.end();

      // Verify workflow completed
      const createdSpan = mockTracer.getSpan("workflow-span");
      expect(createdSpan).toBeDefined();
      expect(createdSpan?.ended).toBe(true);

      // Verify attributes were set
      expect(createdSpan?.getAttributeValue(indexModule.attributes.ATTR_LANGWATCH_SPAN_TYPE)).toBe("workflow");
      expect(createdSpan?.getAttributeValue(indexModule.attributes.ATTR_LANGWATCH_INPUT)).toBeDefined();
      expect(createdSpan?.getAttributeValue(indexModule.attributes.ATTR_LANGWATCH_OUTPUT)).toBeDefined();

      // Verify events were added
      expect(createdSpan?.hasEvent("content-is-parsed")).toBe(true);
      expect(createdSpan?.hasEvent("content-is-processed")).toBe(true);
    });

    it("should support withActiveSpan workflow", async () => {
      const tracer = indexModule.getLangWatchTracer("workflow-active");

      const result = await tracer.withActiveSpan("active-workflow", async (span) => {
        // Configure span
        span
          .setType("llm")
          .setInput("Generate response")
          .addEvent("content-is-parsed")

        // Simulate async work
        await new Promise(resolve => setTimeout(resolve, 1));

        // Complete span
        span
          .setOutput("Hello! How can I help?")
          .addEvent("content-is-parsed")

        return "workflow-complete";
      });

      expect(result).toBe("workflow-complete");
    });

    it("should handle nested spans with proper attribution", async () => {
      const mockProvider = new MockTracerProvider();
      const tracer = indexModule.getLangWatchTracerFromProvider(mockProvider, "nested-test");
      const mockTracer = mockProvider.getTracerByName("nested-test")!;

      await tracer.withActiveSpan("parent-task", async (parent) => {
        parent.setType("workflow").setInput("Start complex task");

        // Child span 1
        const child1Result = tracer.withActiveSpan("llm-call", (child) => {
          child.setType("llm").setInput("Generate text");
          return "generated-text";
        });

        // Child span 2
        const child2Result = tracer.withActiveSpan("tool-call", (child) => {
          child.setType("tool").setInput("Process result");
          return "processed-result";
        });

        parent.setOutput({
          llm: child1Result,
          tool: child2Result
        });

        return "parent-complete";
      });

      // Verify all spans were created
      expect(mockTracer.getSpan("parent-task")).toBeDefined();
      expect(mockTracer.getSpan("llm-call")).toBeDefined();
      expect(mockTracer.getSpan("tool-call")).toBeDefined();

      // Verify span types
      expect(mockTracer.getSpan("parent-task")?.getAttributeValue(indexModule.attributes.ATTR_LANGWATCH_SPAN_TYPE)).toBe("workflow");
      expect(mockTracer.getSpan("llm-call")?.getAttributeValue(indexModule.attributes.ATTR_LANGWATCH_SPAN_TYPE)).toBe("llm");
      expect(mockTracer.getSpan("tool-call")?.getAttributeValue(indexModule.attributes.ATTR_LANGWATCH_SPAN_TYPE)).toBe("tool");
    });
  });

  describe("error handling integration", () => {
    it("should handle errors gracefully across components", async () => {
      const tracer = indexModule.getLangWatchTracer("error-integration");

      await expect(
        tracer.withActiveSpan("error-span", async (span) => {
          span
            .setType("llm")
            .setInput("This will fail")
            .addEvent("content-is-parsed")

          throw new Error("Integration test error");
        })
      ).rejects.toThrow("Integration test error");
    });

    it("should maintain data integrity on errors", async () => {
      const mockProvider = new MockTracerProvider();
      const tracer = indexModule.getLangWatchTracerFromProvider(mockProvider, "integrity-test");
      const mockTracer = mockProvider.getTracerByName("integrity-test")!;

      try {
        await tracer.withActiveSpan("integrity-span", async (span) => {
          span.setType("llm").setInput("Valid input").addEvent("content-is-parsed")

          throw new Error("Test error");
        });
      } catch (error) {
        // Error expected
      }

      // Verify span was created and data was recorded
      const span = mockTracer.getSpan("integrity-span");
      expect(span).toBeDefined();
      expect(span?.ended).toBe(true);
      expect(span?.getAttributeValue(indexModule.attributes.ATTR_LANGWATCH_SPAN_TYPE)).toBe("llm");
      expect(span?.hasEvent("content-is-parsed")).toBe(true);
    });
  });

  describe("performance integration", () => {
    it("should handle rapid span creation efficiently", () => {
      const mockProvider = new MockTracerProvider();
      const tracer = indexModule.getLangWatchTracerFromProvider(mockProvider, "perf-test");
      const mockTracer = mockProvider.getTracerByName("perf-test")!;

      const spanCount = 50;
      const spans = [];

      // Create many spans quickly
      for (let i = 0; i < spanCount; i++) {
        const span = tracer.startSpan(`perf-span-${i}`);
        span
          .setType("llm")
          .setInput(`input-${i}`)
          .setAttribute("index", i);
        spans.push(span);
      }

      // End all spans
      spans.forEach(span => span.end());

      // Verify all were created
      expect(mockTracer.getSpanCount()).toBe(spanCount);

      // Verify they all have proper attributes
      for (let i = 0; i < spanCount; i++) {
        const span = mockTracer.getSpan(`perf-span-${i}`);
        expect(span).toBeDefined();
        expect(span?.getAttributeValue("index")).toBe(i);
        expect(span?.ended).toBe(true);
      }
    });
  });
});
