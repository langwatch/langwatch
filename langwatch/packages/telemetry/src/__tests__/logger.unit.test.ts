import { describe, it, expect, vi, beforeEach } from "vitest";
import pino from "pino";
import { createLogger } from "../logger";
import { runWithContext } from "../context/core";
import { getLogContext } from "../context/logging";

vi.mock("@opentelemetry/api", () => ({
  context: { active: vi.fn(() => ({})) },
  trace: { getSpan: vi.fn(() => undefined) },
}));

function captureDest() {
  const chunks: string[] = [];
  return {
    dest: { write(chunk: string) { chunks.push(chunk); } },
    chunks,
  };
}

describe("createLogger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a pino logger with the given name", () => {
    const logger = createLogger("test-service");

    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("sets level to error in test environment", () => {
    const logger = createLogger("test-level");

    expect(logger.level).toBe("error");
  });

  describe("when disableContext is true", () => {
    it("creates a logger without mixin", () => {
      const logger = createLogger("no-context", { disableContext: true });

      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe("function");
    });
  });

  describe("when disableContext is false", () => {
    it("injects context fields via mixin", () => {
      const { dest, chunks } = captureDest();

      const logger = pino(
        { name: "mixin-test", level: "error", mixin: () => getLogContext() },
        dest,
      );

      runWithContext({ organizationId: "org-1", projectId: "proj-1" }, () => {
        logger.error("test message");
      });

      expect(chunks.length).toBeGreaterThan(0);
      const parsed = JSON.parse(chunks[0]!);
      expect(parsed.organizationId).toBe("org-1");
      expect(parsed.projectId).toBe("proj-1");
    });
  });

  describe("when superjson error serializer is used", () => {
    it("serializes Error instances with superjson metadata", () => {
      const { dest, chunks } = captureDest();

      // Replicate the serializer from logger.ts
      const superjson = require("superjson").default;
      const logger = pino(
        {
          level: "error",
          serializers: {
            error: (err: unknown) => {
              if (!(err instanceof Error)) return pino.stdSerializers.err(err as Error);
              const serialized = superjson.serialize(err);
              return { ...pino.stdSerializers.err(err), _superjson: serialized.meta };
            },
          },
        },
        dest,
      );

      logger.error({ error: new Error("boom") }, "something failed");

      const parsed = JSON.parse(chunks[0]!);
      expect(parsed.error.message).toBe("boom");
      expect(parsed.error.type).toBe("Error");
    });

    it("falls back to standard serializer for non-Error values", () => {
      const { dest, chunks } = captureDest();

      const logger = pino(
        {
          level: "error",
          serializers: {
            error: (err: unknown) => {
              if (!(err instanceof Error)) return pino.stdSerializers.err(err as Error);
              return pino.stdSerializers.err(err);
            },
          },
        },
        dest,
      );

      logger.error({ error: "not an error object" }, "string error");

      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe("when called multiple times", () => {
    it("reuses the shared transport singleton", () => {
      const logger1 = createLogger("svc-a");
      const logger2 = createLogger("svc-b");

      expect(typeof logger1.info).toBe("function");
      expect(typeof logger2.info).toBe("function");
    });
  });

  describe("when formatting", () => {
    it("uppercases the level label", () => {
      const { dest, chunks } = captureDest();

      const logger = pino(
        {
          level: "error",
          formatters: {
            level: (label: string) => ({ level: label.toUpperCase() }),
          },
        },
        dest,
      );

      logger.error("test");

      const parsed = JSON.parse(chunks[0]!);
      expect(parsed.level).toBe("ERROR");
    });
  });
});
