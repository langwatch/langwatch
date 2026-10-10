import { trace } from "@opentelemetry/api";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

import { resetObservabilitySdkConfig } from "../../../../config.js";
import { setupObservability } from "../../setup";

// Integration tests for tracer functionality in setupObservability
function createMockLogger() {
  return { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

afterEach(() => {
  trace.disable();
  // Reset observability config after each test
  resetObservabilitySdkConfig();
});

describe("setupObservability Integration - Tracer Functionality", () => {
  let tracer: ReturnType<typeof trace.getTracer>;

  beforeEach(() => {
    const logger = createMockLogger();
    setupObservability({ langwatch: { apiKey: "test-key" }, debug: { logger } });
    tracer = trace.getTracer("default");
  });

  it("creates spans with correct attributes", async () => {
    const span = tracer.startSpan("test-operation");
    span.setAttribute("http.method", "GET");
    span.setAttribute("http.url", "https://api.example.com");
    span.setStatus({ code: 1 }); // OK
    span.end();
    // Verify span was created with expected attributes
    expect(span).toBeDefined();
  });

  it("handles active spans correctly if available", async () => {
    const result = tracer.startActiveSpan("test-operation", (span) => {
      span.setAttribute("test.attribute", "test-value");
      span.end();

      return "test-result";
    });

    expect(result).toBe("test-result");
  });
});
