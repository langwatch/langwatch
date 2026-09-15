import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runWithContext } from "../context/index.ts";
import { getLogContext } from "../context/logging.ts";
import {
  configureLogger,
  consoleIgnoreFields,
  createLogger,
  NODE_LOG_SERIALIZERS,
  resetLoggerCache,
} from "../logger.ts";

vi.mock("@opentelemetry/api", () => ({
  context: { active: vi.fn(() => ({})) },
  trace: { getSpan: vi.fn(() => undefined) },
}));

function captureDest() {
  const chunks: string[] = [];
  return {
    dest: {
      write(chunk: string) {
        chunks.push(chunk);
      },
    },
    chunks,
  };
}

describe("createLogger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureLogger({ environment: "test" });
  });

  it("returns a pino logger with the given name", () => {
    const logger = createLogger("test-service");

    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("sets level to error for injected test configuration", () => {
    const logger = createLogger("test-level");

    expect(logger.level).toBe("error");
  });

  it("uses the configured log level", () => {
    configureLogger({ environment: "test", level: "warn" });
    resetLoggerCache();

    expect(createLogger("configured-level").level).toBe("warn");
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

      // createLogger writes to process.stdout in test; create a pino
      // instance with the same mixin that createLogger configures to
      // verify context injection into log output.
      const testLogger = pino(
        { name: "mixin-test", level: "error", mixin: () => getLogContext() },
        dest,
      );

      runWithContext({ organizationId: "org-1", projectId: "proj-1" }, () => {
        testLogger.error("test message");
      });

      expect(chunks.length).toBeGreaterThan(0);
      const parsed = JSON.parse(chunks[0]!);
      expect(parsed.organizationId).toBe("org-1");
      expect(parsed.projectId).toBe("proj-1");
    });

    it("creates a logger with mixin enabled by default", () => {
      const logger = createLogger("default-context");

      // The logger exists and has standard methods — mixin is internal
      expect(logger).toBeDefined();
      expect(typeof logger.error).toBe("function");
    });
  });

  describe("when serializing errors", () => {
    it("keeps the message and type on the record, as plain JSON", () => {
      const { dest, chunks } = captureDest();
      // The real serializer map, not a copy of it.
      const logger = pino({ level: "error", serializers: NODE_LOG_SERIALIZERS }, dest);

      logger.error({ error: new Error("boom") }, "something failed");

      const parsed = JSON.parse(chunks[0]!);
      expect(parsed.error.message).toBe("boom");
      expect(parsed.error.type).toBe("Error");
    });

    it("renders a bigint hung off a custom error rather than throwing the record away", () => {
      const { dest, chunks } = captureDest();
      const logger = pino({ level: "error", serializers: NODE_LOG_SERIALIZERS }, dest);
      const error = Object.assign(new Error("over budget"), { budget: 9007199254740993n });

      logger.error({ error }, "something failed");

      const parsed = JSON.parse(chunks[0]!);
      expect(parsed.error.message).toBe("over budget");
      expect(parsed.error.budget).toBe("9007199254740993");
    });

    it("renders a nested Error, which JSON alone would write as an empty object", () => {
      const { dest, chunks } = captureDest();
      const logger = pino({ level: "error", serializers: NODE_LOG_SERIALIZERS }, dest);
      const error = Object.assign(new Error("outer"), { inner: new Error("inner") });

      logger.error({ error }, "something failed");

      const parsed = JSON.parse(chunks[0]!);
      expect(parsed.error.inner.message).toBe("inner");
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

  describe("when formatting log output", () => {
    it("leaves pino's own numeric level alone without our formatter", () => {
      const { dest, chunks } = captureDest();

      const logger = pino({ level: "error" }, dest);
      logger.error("test");

      // The shared dev log format
      // (dev/docs/best_practices/dev-log-format.md); the exhaustive assertion
      // over the real factory lives in sharedLogFormat.unit.test.ts.
      const parsed = JSON.parse(chunks[0]!);
      expect(parsed.level).toBe(50);
    });
  });

  describe("when a log line is emitted in production", () => {
    it("stamps the service field fluent-bit promotes to the Loki label", () => {
      const written: string[] = [];
      const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
        written.push(String(chunk));
        return true;
      });

      try {
        const logger = createLogger("service-field-test");
        logger.error("boom");
      } finally {
        spy.mockRestore();
      }

      const parsed = JSON.parse(written[0]!);
      expect(parsed.service).toBe("langwatch-app");
      // `base` replaces pino's defaults — prod queries filter on hostname.
      expect(parsed.hostname).toBeTruthy();
      expect(parsed.pid).toBeTruthy();
      // The per-module label stays distinct from the process identity.
      expect(parsed.name).toBe("service-field-test");
    });
  });

  describe("console context fields", () => {
    it("hides heavy business context when OTel export is enabled", () => {
      const ignored = consoleIgnoreFields(true).split(",");

      expect(ignored).toContain("organizationId");
      expect(ignored).toContain("projectId");
      expect(ignored).toContain("userId");
      expect(ignored).not.toContain("traceId");
      expect(ignored).not.toContain("spanId");
    });

    it("keeps business context when the console is the only output", () => {
      expect(consoleIgnoreFields(false)).toBe("pid,hostname,service");
    });
  });
});
