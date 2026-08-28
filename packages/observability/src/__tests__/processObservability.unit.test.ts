import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  shutdown: vi.fn(async () => void 0),
  setupObservability: vi.fn(),
  getLangWatchTracer: vi.fn(),
}));

vi.mock("../logger", () => ({
  createLogger: vi.fn(() => mocks.logger),
}));

vi.mock("langwatch/observability/node", () => ({
  setupObservability: mocks.setupObservability,
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: mocks.getLangWatchTracer,
}));

import { createProcessObservability } from "../node/process-observability";

describe("createProcessObservability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.shutdown.mockResolvedValue(void 0);
    mocks.setupObservability.mockReturnValue({ shutdown: mocks.shutdown });
    mocks.getLangWatchTracer.mockReturnValue({ name: "test-tracer" });
  });

  it("creates one process logger and tracer with SDK auto-shutdown disabled", () => {
    const observability = createProcessObservability({
      serviceName: "langwatch:api",
      setup: {
        langwatch: "disabled",
      },
    });

    expect(observability.logger).toBe(mocks.logger);
    expect(observability.tracer).toEqual({ name: "test-tracer" });
    expect(mocks.getLangWatchTracer).toHaveBeenCalledWith("langwatch:api");
    expect(mocks.setupObservability).toHaveBeenCalledWith(
      expect.objectContaining({
        langwatch: "disabled",
        serviceName: "langwatch:api",
        advanced: { disableAutoShutdown: true },
      }),
    );
  });

  it("makes shutdown idempotent so lifecycle retry cannot close the SDK twice", async () => {
    const observability = createProcessObservability({ serviceName: "langwatch:worker" });

    const first = observability.shutdown();
    const second = observability.shutdown();

    expect(second).toBe(first);
    await first;
    expect(mocks.shutdown).toHaveBeenCalledTimes(1);
  });
});
