import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock pino before importing logger
vi.mock("pino", () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
    level: "info",
  };
  const pinoFn = vi.fn(() => mockLogger) as any;
  pinoFn.transport = vi.fn(() => ({}));
  pinoFn.stdTimeFunctions = { isoTime: () => ',"time":"2024-01-01T00:00:00Z"' };
  pinoFn.stdSerializers = { err: (e: Error) => ({ message: e.message }) };
  return { default: pinoFn };
});

describe("server createLogger", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("creates a logger with the given name", async () => {
    const { createLogger } = await import("../logger/server");
    const pino = (await import("pino")).default;

    createLogger("test-logger");

    expect(pino).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "test-logger",
      }),
      expect.anything()
    );
  });

  it("sets the logger level from environment", async () => {
    const originalEnv = process.env.PINO_LOG_LEVEL;
    process.env.PINO_LOG_LEVEL = "debug";

    vi.resetModules();
    const { createLogger } = await import("../logger/server");
    const pino = (await import("pino")).default;

    createLogger("test-level");

    expect(pino).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "debug",
      }),
      expect.anything()
    );

    process.env.PINO_LOG_LEVEL = originalEnv;
  });

  it("configures mixin for context injection when not disabled", async () => {
    const { createLogger } = await import("../logger/server");
    const pino = (await import("pino")).default;

    createLogger("mixin-test");

    const options = (pino as any).mock.calls[0]?.[0];
    expect(options.mixin).toBeDefined();
    expect(typeof options.mixin).toBe("function");
  });

  it("disables mixin when disableContext is true", async () => {
    const { createLogger } = await import("../logger/server");
    const pino = (await import("pino")).default;

    createLogger("no-context", { disableContext: true });

    const options = (pino as any).mock.calls[0]?.[0];
    expect(options.mixin).toBeUndefined();
  });

  it("returns a pino logger instance", async () => {
    const { createLogger } = await import("../logger/server");

    const logger = createLogger("instance-test");

    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });
});

describe("client createLogger (universal)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("creates a logger with the given name", async () => {
    const { createLogger } = await import("../logger");
    const pino = (await import("pino")).default;

    createLogger("test-client-logger");

    expect(pino).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "test-client-logger",
      })
    );
  });

  it("returns a pino logger instance", async () => {
    const { createLogger } = await import("../logger");

    const logger = createLogger("client-instance-test");

    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
  });
});
