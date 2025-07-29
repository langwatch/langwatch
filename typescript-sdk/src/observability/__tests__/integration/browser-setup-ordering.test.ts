import { describe, it, expect, vi } from "vitest";
import { setup as setupBrowser } from "../../../client-browser";
import { getLangWatchTracer } from "../../trace";

// Mock window object for Node.js test environment
const mockWindow = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};
global.window = mockWindow as any;

describe("Browser SDK setup ordering", () => {
  it("should work when LangWatch browser setup is called multiple times", async () => {
    // First setup
    await setupBrowser({
      apiKey: "test-key-1",
      endpoint: "http://localhost:9999",
      disableOpenTelemetryAutomaticSetup: false,
    });

    // Second setup should work (browser doesn't have the same restriction as node)
    await setupBrowser({
      apiKey: "test-key-2",
      endpoint: "http://localhost:9999",
      disableOpenTelemetryAutomaticSetup: false,
    });

    // Test that LangWatch still works
    const tracer = getLangWatchTracer("browser-multiple-test");
    await tracer.withActiveSpan("test span", async () => {
      expect(true).toBe(true);
    });
  });

  it("should work when LangWatch is set up with disableOpenTelemetryAutomaticSetup=true", async () => {
    // Setup LangWatch with automatic setup disabled
    await setupBrowser({
      apiKey: "test-key",
      endpoint: "http://localhost:9999",
      disableOpenTelemetryAutomaticSetup: true,
    });

    // Test that LangWatch still works
    const tracer = getLangWatchTracer("browser-disabled-test");
    await tracer.withActiveSpan("test span", async () => {
      expect(true).toBe(true);
    });
  });

  it("should handle window event listeners correctly", async () => {
    await setupBrowser({
      apiKey: "test-key",
      endpoint: "http://localhost:9999",
      disableOpenTelemetryAutomaticSetup: false,
    });

    // Check that window event listeners were added
    expect(mockWindow.addEventListener).toHaveBeenCalled();
  });
});
