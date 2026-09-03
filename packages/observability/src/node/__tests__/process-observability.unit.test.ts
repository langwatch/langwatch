import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setupObservability = vi.fn((_options: Record<string, unknown>) => ({
  shutdown: () => Promise.resolve(),
}));

vi.mock("langwatch/observability/node", () => ({
  setupObservability: (options: Record<string, unknown>) => setupObservability(options),
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({}),
}));

import { createProcessObservability } from "../process-observability";
import { UnexportedSpanProcessor } from "../unexported-spans";

/** What the SDK was actually handed, for the one call this test made. */
function sdkOptions(): {
  spanProcessors?: readonly unknown[];
  advanced?: Record<string, unknown>;
} {
  expect(setupObservability).toHaveBeenCalledTimes(1);
  return setupObservability.mock.calls[0]?.[0] as never;
}

beforeEach(() => {
  setupObservability.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("given a process configured with no LangWatch credentials", () => {
  describe("when it composes its observability", () => {
    /** @scenario "A process with nowhere to send traces records them anyway and says nothing" */
    it("keeps OpenTelemetry on and says where the spans go", () => {
      createProcessObservability({
        serviceName: "langwatch-api",
        setup: { langwatch: "disabled" },
      });

      const options = sdkOptions();

      // Not `advanced.disabled`: that returns a no-op handle and registers no
      // provider, so every log line loses the trace id that groups a request's
      // lines together in a five-lane terminal.
      expect(options.advanced?.disabled).toBeUndefined();
      expect(options.advanced?.skipOpenTelemetrySetup).toBeUndefined();
      expect(options.spanProcessors).toHaveLength(1);
      expect(options.spanProcessors?.[0]).toBeInstanceOf(UnexportedSpanProcessor);
    });
  });
});

describe("given a process configured with a LangWatch API key", () => {
  describe("when it composes its observability", () => {
    /** @scenario "A process with somewhere to send traces is left alone" */
    it("adds nothing in front of the exporter it was given", () => {
      createProcessObservability({
        serviceName: "langwatch-api",
        setup: { langwatch: { apiKey: "lw-key" } },
      });

      expect(sdkOptions().spanProcessors).toBeUndefined();
    });
  });
});

describe("given a process that passes span processors of its own", () => {
  describe("when it composes its observability", () => {
    /** @scenario "A process that supplies its own span processors is left alone" */
    it("hands over exactly those, with nothing added", () => {
      const ownProcessor = new UnexportedSpanProcessor();

      createProcessObservability({
        serviceName: "langwatch-api",
        setup: { langwatch: "disabled", spanProcessors: [ownProcessor] },
      });

      expect(sdkOptions().spanProcessors).toEqual([ownProcessor]);
    });
  });
});
