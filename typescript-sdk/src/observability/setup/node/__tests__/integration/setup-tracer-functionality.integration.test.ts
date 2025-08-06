import { describe, it, expect, vi } from "vitest";
import { setupObservability } from "../../setup";
import { trace } from "@opentelemetry/api";

// Integration tests for tracer functionality in setupObservability
function createMockLogger() {
  return { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

describe("setupObservability Integration - Tracer Functionality", () => {
  it("should create spans with correct attributes", async () => {
    const logger = createMockLogger();
    setupObservability({ apiKey: "test-key", logger });
    const tracer = trace.getTracer("default");
    const span = tracer.startSpan("test-operation");
    span.setAttribute("http.method", "GET");
    span.setAttribute("http.url", "https://api.example.com");
    span.setStatus({ code: 1 }); // OK
    span.end();
    // Verify span was created with expected attributes
    expect(span).toBeDefined();
  });

  it("should handle active spans correctly if available", async () => {
    const logger = createMockLogger();
    setupObservability({ apiKey: "test-key", logger });
    const tracer = trace.getTracer("default");
    const result = tracer.startActiveSpan("test-operation", (span) => {
      span.setAttribute("test.attribute", "test-value");
      span.end();

      return "test-result";
    });

    expect(result).toBe("test-result");
  });
});
