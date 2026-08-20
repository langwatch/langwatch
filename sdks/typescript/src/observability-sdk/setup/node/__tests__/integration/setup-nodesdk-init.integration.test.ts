import { trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetObservabilitySdkConfig } from "../../../../config.js";
import { isConcreteProvider } from "../../../utils";
import { setupObservability } from "../../setup";

// Integration tests for NodeSDK initialization in setupObservability
function createMockLogger() {
  return { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

afterEach(() => {
  trace.disable();
  // Reset observability config after each test
  resetObservabilitySdkConfig();
});

describe("setupObservability Integration - NodeSDK Initialization", () => {
  it("initializes NodeSDK when no global provider exists", async () => {
    const logger = createMockLogger();
    const handle = setupObservability({
      langwatch: { apiKey: "test-key" },
      debug: { logger },
    });
    expect(typeof handle.shutdown).toBe("function");

    // Check that the global tracer provider is no longer a no-op
    expect(isConcreteProvider(trace.getTracerProvider())).toBe(true);

    // Should be able to call shutdown without error
    await expect(handle.shutdown()).resolves.toBeUndefined();

    // Optionally, check that logger.info was called for NodeSDK init
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("NodeSDK started successfully"),
    );
  });
});
