import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it, vi } from "vitest";
import {
  ConfigurationError,
  categorizeError,
  classifyClickHouseError,
  ErrorCategory,
  HandlerError,
  handleError,
  ProjectionError,
  QueueError,
  SecurityError,
  StoreError,
  ValidationError,
} from "../errorHandling";

const TRANSIENT_NETWORK_CODES = [
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
] as const;

class TestHandledError extends HandledError {
  constructor(code: string, reasons: Error[]) {
    super(code, code, { reasons });
  }
}

class ClickHouseOverloadedError extends TestHandledError {
  constructor({ reasons }: { reasons: Error[] }) {
    super("clickhouse_overloaded", reasons);
  }
}

class ClickHouseUnavailableError extends TestHandledError {
  constructor({ reasons }: { reasons: Error[] }) {
    super("clickhouse_unavailable", reasons);
  }
}

class QueryMemoryExceededError extends TestHandledError {
  constructor({ reasons }: { reasons: Error[] }) {
    super("query_memory_exceeded", reasons);
  }
}

const createMockLogger = () => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn().mockReturnThis(),
  silent: vi.fn(),
});

describe("Error classes", () => {
  describe("SecurityError", () => {
    it("has correct name and CRITICAL category", () => {
      const err = new SecurityError("op", "breach detected", "tenant-1");
      expect(err.name).toBe("SecurityError");
      expect(err.category).toBe(ErrorCategory.CRITICAL);
    });

    it("getLogContext() includes operation and tenantId", () => {
      const err = new SecurityError("op", "breach", "t-1");
      const ctx = err.getLogContext();
      expect(ctx).toMatchObject({
        errorName: "SecurityError",
        errorMessage: "[SECURITY] breach",
        errorCategory: ErrorCategory.CRITICAL,
        operation: "op",
        tenantId: "t-1",
      });
    });
  });

  describe("ValidationError", () => {
    it("has correct name and CRITICAL category", () => {
      const err = new ValidationError("bad input", "email", "notanemail");
      expect(err.name).toBe("ValidationError");
      expect(err.category).toBe(ErrorCategory.CRITICAL);
    });

    it("getLogContext() includes field, value, and reason", () => {
      const err = new ValidationError("bad input", "email", "x");
      const ctx = err.getLogContext();
      expect(ctx).toMatchObject({
        errorName: "ValidationError",
        errorCategory: ErrorCategory.CRITICAL,
        field: "email",
        value: "x",
        reason: "bad input",
      });
    });

    it("message omits field when not provided", () => {
      const err = new ValidationError("missing data");
      expect(err.message).toBe("[VALIDATION] missing data");
    });

    it("message includes field when provided", () => {
      const err = new ValidationError("too long", "name");
      expect(err.message).toBe("[VALIDATION] too long (field: name)");
    });
  });

  describe("ConfigurationError", () => {
    it("has correct name and CRITICAL category", () => {
      const err = new ConfigurationError("Pipeline", "missing handler");
      expect(err.name).toBe("ConfigurationError");
      expect(err.category).toBe(ErrorCategory.CRITICAL);
    });

    it("getLogContext() includes component and details", () => {
      const err = new ConfigurationError("Pipeline", "missing handler");
      const ctx = err.getLogContext();
      expect(ctx).toMatchObject({
        errorName: "ConfigurationError",
        errorCategory: ErrorCategory.CRITICAL,
        component: "Pipeline",
        details: "missing handler",
      });
    });
  });

  describe("StoreError", () => {
    it("has correct name", () => {
      const err = new StoreError(
        "insert",
        "clickhouse",
        "timeout",
        ErrorCategory.RECOVERABLE,
      );
      expect(err.name).toBe("StoreError");
    });

    it("can be CRITICAL", () => {
      const err = new StoreError(
        "insert",
        "clickhouse",
        "corruption",
        ErrorCategory.CRITICAL,
      );
      expect(err.category).toBe(ErrorCategory.CRITICAL);
    });

    it("can be RECOVERABLE", () => {
      const err = new StoreError(
        "query",
        "clickhouse",
        "timeout",
        ErrorCategory.RECOVERABLE,
      );
      expect(err.category).toBe(ErrorCategory.RECOVERABLE);
    });

    it("getLogContext() includes operation and store", () => {
      const err = new StoreError(
        "insert",
        "clickhouse",
        "fail",
        ErrorCategory.RECOVERABLE,
      );
      const ctx = err.getLogContext();
      expect(ctx).toMatchObject({
        errorName: "StoreError",
        errorCategory: ErrorCategory.RECOVERABLE,
        operation: "insert",
        store: "clickhouse",
      });
    });
  });

  describe("QueueError", () => {
    it("has correct name and RECOVERABLE category", () => {
      const err = new QueueError("events", "enqueue", "redis down");
      expect(err.name).toBe("QueueError");
      expect(err.category).toBe(ErrorCategory.RECOVERABLE);
    });

    it("getLogContext() includes queueName and operation", () => {
      const ctx = new QueueError("events", "enqueue", "fail").getLogContext();
      expect(ctx).toMatchObject({
        errorName: "QueueError",
        queueName: "events",
        operation: "enqueue",
      });
    });
  });

  describe("HandlerError", () => {
    it("has correct name and NON_CRITICAL category", () => {
      const err = new HandlerError("myHandler", "evt-1", "oops");
      expect(err.name).toBe("HandlerError");
      expect(err.category).toBe(ErrorCategory.NON_CRITICAL);
    });

    it("getLogContext() includes handlerName and eventId", () => {
      const ctx = new HandlerError("h", "e-1", "fail").getLogContext();
      expect(ctx).toMatchObject({
        errorName: "HandlerError",
        handlerName: "h",
        eventId: "e-1",
      });
    });
  });

  describe("ProjectionError", () => {
    it("has correct name and NON_CRITICAL category", () => {
      const err = new ProjectionError("proj", "evt-1", "oops");
      expect(err.name).toBe("ProjectionError");
      expect(err.category).toBe(ErrorCategory.NON_CRITICAL);
    });

    it("getLogContext() includes projectionName and eventId", () => {
      const ctx = new ProjectionError("proj", "e-1", "fail").getLogContext();
      expect(ctx).toMatchObject({
        errorName: "ProjectionError",
        projectionName: "proj",
        eventId: "e-1",
      });
    });
  });
});

describe("handleError", () => {
  describe("with BaseEventSourcingError", () => {
    it("throws when category is CRITICAL", () => {
      const err = new SecurityError("op", "breach");
      expect(() => handleError(err, ErrorCategory.NON_CRITICAL)).toThrow(err);
    });

    it("logs error and does not throw when NON_CRITICAL with logger", () => {
      const logger = createMockLogger();
      const err = new HandlerError("h", "e-1", "minor issue");
      expect(() => handleError(err, ErrorCategory.CRITICAL, logger as any)).not.toThrow();
      expect(logger.error).toHaveBeenCalledOnce();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ errorName: "HandlerError" }),
        "Non-critical error occurred, continuing operation",
      );
    });

    it("does not throw or crash when NON_CRITICAL without logger", () => {
      const err = new HandlerError("h", "e-1", "minor");
      expect(() => handleError(err, ErrorCategory.CRITICAL)).not.toThrow();
    });

    it("logs warning and does not throw when RECOVERABLE with logger", () => {
      const logger = createMockLogger();
      const err = new QueueError("q", "enqueue", "redis timeout");
      expect(() => handleError(err, ErrorCategory.CRITICAL, logger as any)).not.toThrow();
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ errorName: "QueueError" }),
        "Recoverable error occurred, should retry",
      );
    });

    it("does not throw or crash when RECOVERABLE without logger", () => {
      const err = new QueueError("q", "enqueue", "timeout");
      expect(() => handleError(err, ErrorCategory.CRITICAL)).not.toThrow();
    });

    it("merges additional context with error context", () => {
      const logger = createMockLogger();
      const err = new HandlerError("h", "e-1", "oops");
      handleError(err, ErrorCategory.NON_CRITICAL, logger as any, {
        extra: "data",
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          errorName: "HandlerError",
          handlerName: "h",
          eventId: "e-1",
          extra: "data",
          err,
        }),
        expect.any(String),
      );
    });
  });

  describe("with plain Error", () => {
    it("throws when category is CRITICAL", () => {
      const err = new Error("boom");
      expect(() => handleError(err, ErrorCategory.CRITICAL)).toThrow(err);
    });

    it("logs error and does not throw when NON_CRITICAL with logger", () => {
      const logger = createMockLogger();
      const err = new Error("oops");
      expect(() =>
        handleError(err, ErrorCategory.NON_CRITICAL, logger as any),
      ).not.toThrow();
      expect(logger.error).toHaveBeenCalledOnce();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: "oops", err }),
        "Non-critical error occurred, continuing operation",
      );
    });

    it("logs warning and does not throw when RECOVERABLE with logger", () => {
      const logger = createMockLogger();
      const err = new Error("transient");
      expect(() =>
        handleError(err, ErrorCategory.RECOVERABLE, logger as any),
      ).not.toThrow();
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ error: "transient", err }),
        "Recoverable error occurred, should retry",
      );
    });
  });

  describe("with non-Error value", () => {
    it("logs and does not throw when NON_CRITICAL with logger", () => {
      const logger = createMockLogger();
      expect(() =>
        handleError("string error", ErrorCategory.NON_CRITICAL, logger as any),
      ).not.toThrow();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: "string error" }),
        "Non-critical error occurred, continuing operation",
      );
    });
  });
});

describe("categorizeError", () => {
  it("returns CRITICAL for SecurityError", () => {
    expect(categorizeError(new SecurityError("op", "msg"))).toBe(ErrorCategory.CRITICAL);
  });

  it("returns CRITICAL for ValidationError", () => {
    expect(categorizeError(new ValidationError("reason"))).toBe(ErrorCategory.CRITICAL);
  });

  it("returns RECOVERABLE for QueueError", () => {
    expect(categorizeError(new QueueError("q", "op", "msg"))).toBe(
      ErrorCategory.RECOVERABLE,
    );
  });

  it("returns NON_CRITICAL for HandlerError", () => {
    expect(categorizeError(new HandlerError("h", "e", "msg"))).toBe(
      ErrorCategory.NON_CRITICAL,
    );
  });

  it("returns NON_CRITICAL for ProjectionError", () => {
    expect(categorizeError(new ProjectionError("p", "e", "msg"))).toBe(
      ErrorCategory.NON_CRITICAL,
    );
  });

  it("returns RECOVERABLE for plain Error", () => {
    expect(categorizeError(new Error("unknown"))).toBe(ErrorCategory.RECOVERABLE);
  });

  it("returns RECOVERABLE for non-Error value", () => {
    expect(categorizeError("not an error")).toBe(ErrorCategory.RECOVERABLE);
  });
});

describe("classifyClickHouseError", () => {
  /**
   * Shedding exists so a busy platform refuses work instead of queueing it
   * without limit. That only holds if the refusal is retryable: a job turned
   * away BECAUSE ClickHouse was busy has to come back, not be dropped.
   *
   * The shed signal underneath — a full wait queue, or a wait that expired —
   * carries no ClickHouse code and matches no transient message fragment, so
   * classifying by the wrapped reasons alone made every shed statement
   * CRITICAL. The verdict is on the handled shell, and has to be read there.
   */
  describe("when the platform shed the statement rather than queue it", () => {
    /** @scenario a statement that waits too long is refused, not left waiting */
    it("returns RECOVERABLE so the job is re-staged, not dropped", () => {
      const shed = new ClickHouseOverloadedError({
        reasons: [
          new Error(
            "ClickHouse concurrency queue is full (64 waiting). Shedding rather than queueing further.",
          ),
        ],
      });

      expect(classifyClickHouseError(shed)).toBe(ErrorCategory.RECOVERABLE);
    });

    it("returns RECOVERABLE for an expired wait, whose reason names no ClickHouse code", () => {
      const shed = new ClickHouseOverloadedError({
        reasons: [new Error("Aborted while waiting for a ClickHouse concurrency slot.")],
      });

      expect(classifyClickHouseError(shed)).toBe(ErrorCategory.RECOVERABLE);
    });

    it("still treats an unrelated handled error by its cause", () => {
      const notShed = new ClickHouseUnavailableError({
        reasons: [new Error("some permanent schema problem")],
      });

      expect(classifyClickHouseError(notShed)).toBe(ErrorCategory.CRITICAL);
    });
  });

  describe("when error has a transient ClickHouse error code", () => {
    it("returns RECOVERABLE for code 202 (TOO_MANY_SIMULTANEOUS_QUERIES)", () => {
      const err = Object.assign(new Error("Too many simultaneous queries"), {
        code: "202",
      });
      expect(classifyClickHouseError(err)).toBe(ErrorCategory.RECOVERABLE);
    });

    it("returns RECOVERABLE for code 159 (TIMEOUT_EXCEEDED)", () => {
      const err = Object.assign(new Error("timeout"), { code: "159" });
      expect(classifyClickHouseError(err)).toBe(ErrorCategory.RECOVERABLE);
    });

    it("returns RECOVERABLE for code 241 (MEMORY_LIMIT_EXCEEDED)", () => {
      const err = Object.assign(new Error("memory"), { code: "241" });
      expect(classifyClickHouseError(err)).toBe(ErrorCategory.RECOVERABLE);
    });

    it("returns RECOVERABLE for code 394 (QUERY_WAS_CANCELLED)", () => {
      const err = Object.assign(new Error("cancelled"), { code: "394" });
      expect(classifyClickHouseError(err)).toBe(ErrorCategory.RECOVERABLE);
    });

    it("returns RECOVERABLE for code 242 (TABLE_IS_READ_ONLY)", () => {
      const err = Object.assign(new Error("readonly"), { code: "242" });
      expect(classifyClickHouseError(err)).toBe(ErrorCategory.RECOVERABLE);
    });

    it("returns RECOVERABLE for code 999 (KEEPER_EXCEPTION)", () => {
      const err = Object.assign(new Error("zk"), { code: "999" });
      expect(classifyClickHouseError(err)).toBe(ErrorCategory.RECOVERABLE);
    });

    it("returns RECOVERABLE for code 236 (ABORTED)", () => {
      const err = Object.assign(new Error("aborted"), { code: "236" });
      expect(classifyClickHouseError(err)).toBe(ErrorCategory.RECOVERABLE);
    });

    it("returns RECOVERABLE for code 33 (CANNOT_READ_ALL_DATA)", () => {
      const err = Object.assign(new Error("truncated"), { code: "33" });
      expect(classifyClickHouseError(err)).toBe(ErrorCategory.RECOVERABLE);
    });
  });

  describe("when error message matches transient patterns", () => {
    it("returns RECOVERABLE for 'Too many simultaneous queries' message", () => {
      expect(
        classifyClickHouseError(
          new Error("Too many simultaneous queries. Maximum: 100. "),
        ),
      ).toBe(ErrorCategory.RECOVERABLE);
    });

    it("returns RECOVERABLE for connection refused", () => {
      expect(
        classifyClickHouseError(new Error("connect ECONNREFUSED 127.0.0.1:8123")),
      ).toBe(ErrorCategory.RECOVERABLE);
    });

    it("returns RECOVERABLE for connection timeout", () => {
      expect(classifyClickHouseError(new Error("connect ETIMEDOUT"))).toBe(
        ErrorCategory.RECOVERABLE,
      );
    });

    it("returns RECOVERABLE for MEMORY_LIMIT_EXCEEDED message-only (no `code` field)", () => {
      expect(
        classifyClickHouseError(
          new Error(
            "Code: 241. DB::Exception: Memory limit (for query) exceeded: would use 3.5 GiB. (MEMORY_LIMIT_EXCEEDED)",
          ),
        ),
      ).toBe(ErrorCategory.RECOVERABLE);
    });

    it("returns RECOVERABLE for 'Query was cancelled' message (CH replica graceful shutdown)", () => {
      expect(
        classifyClickHouseError(
          new Error(
            "Code: 394. DB::Exception: Query was cancelled. (QUERY_WAS_CANCELLED)",
          ),
        ),
      ).toBe(ErrorCategory.RECOVERABLE);
    });

    it("returns RECOVERABLE for 'Table is in readonly mode' message (ZK session lost)", () => {
      expect(
        classifyClickHouseError(
          new Error(
            "Code: 242. DB::Exception: Table is in readonly mode (replica path: /clickhouse/tables/...)",
          ),
        ),
      ).toBe(ErrorCategory.RECOVERABLE);
    });

    it("returns RECOVERABLE for Coordination::Exception (KEEPER_EXCEPTION)", () => {
      expect(
        classifyClickHouseError(
          new Error(
            "Code: 999. Coordination::Exception: Session expired. (KEEPER_EXCEPTION)",
          ),
        ),
      ).toBe(ErrorCategory.RECOVERABLE);
    });

    it("returns RECOVERABLE for 'Connection loss' message (Keeper coordinator dropped)", () => {
      expect(
        classifyClickHouseError(
          new Error(
            "Code: 999. Coordination::Exception: Coordination error: Connection loss.",
          ),
        ),
      ).toBe(ErrorCategory.RECOVERABLE);
    });

    describe("when the connection died before the server answered", () => {
      // A worker rollout aborts whatever ClickHouse work the pod was holding.
      // The driver reports that as `socket hang up` carrying an errno, not a
      // ClickHouse code — and classifying it CRITICAL dead-lettered the job
      // instead of re-staging it, blocking the group. Prod, 2026-08-10.
      /** @scenario A socket hang up is recoverable, not a data-integrity failure */
      it("returns RECOVERABLE for a socket hang up carrying ECONNRESET", () => {
        expect(
          classifyClickHouseError(
            Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
          ),
        ).toBe(ErrorCategory.RECOVERABLE);
      });

      /** @scenario Socket-level failures are recoverable whatever the errno */
      it.each([
        "ECONNRESET",
        "ECONNREFUSED",
        "EPIPE",
        "ETIMEDOUT",
        "EHOSTUNREACH",
        "ENETUNREACH",
        "EAI_AGAIN",
      ])("returns RECOVERABLE for socket errno %s", (code) => {
        expect(
          classifyClickHouseError(Object.assign(new Error("request failed"), { code })),
        ).toBe(ErrorCategory.RECOVERABLE);
      });

      // Both message forms, because they come from different layers: "socket
      // hang up" is Node's http module, "other side closed" is undici's.
      // Either is all that survives an error that crossed a worker or
      // serialisation boundary and lost its errno.
      /** @scenario A socket failure that survived only as a message is still recoverable */
      it.each(["socket hang up", "other side closed"])(
        "returns RECOVERABLE for a bare %j message with no code",
        (message) => {
          expect(classifyClickHouseError(new Error(message))).toBe(
            ErrorCategory.RECOVERABLE,
          );
        },
      );

      // The shared client owns the retry policy for reads; this classifier
      // owns it for queued jobs. They read the same failures, so a code the
      // client retries must not be one this classifier dead-letters.
      /** @scenario The queue classifier agrees with the ClickHouse client's classifier */
      it("agrees with every socket code the shared ClickHouse client retries", () => {
        for (const code of TRANSIENT_NETWORK_CODES) {
          expect(
            classifyClickHouseError(Object.assign(new Error("request failed"), { code })),
          ).toBe(ErrorCategory.RECOVERABLE);
        }
      });

      /** @scenario A genuine data error is still critical */
      it("returns CRITICAL for an unknown-table error", () => {
        expect(
          classifyClickHouseError(
            Object.assign(
              new Error(
                "Code: 60. DB::Exception: Table default.nope does not exist. (UNKNOWN_TABLE)",
              ),
              { code: "60" },
            ),
          ),
        ).toBe(ErrorCategory.CRITICAL);
      });
    });
  });

  describe("when error is not transient", () => {
    it("returns CRITICAL for unknown ClickHouse errors", () => {
      expect(classifyClickHouseError(new Error("Syntax error in SQL"))).toBe(
        ErrorCategory.CRITICAL,
      );
    });

    it("returns CRITICAL for null/undefined", () => {
      expect(classifyClickHouseError(null)).toBe(ErrorCategory.CRITICAL);
      expect(classifyClickHouseError(undefined)).toBe(ErrorCategory.CRITICAL);
    });
  });

  describe("when the resilient client's translation wrapped the raw error", () => {
    it("returns RECOVERABLE for a handled query_memory_exceeded wrapping code 241", () => {
      const raw = Object.assign(new Error("memory"), { code: "241" });
      const translated = new QueryMemoryExceededError({ reasons: [raw] });
      expect(classifyClickHouseError(translated)).toBe(ErrorCategory.RECOVERABLE);
    });

    it("returns RECOVERABLE for a handled clickhouse_unavailable wrapping ECONNREFUSED", () => {
      const raw = Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      });
      const translated = new ClickHouseUnavailableError({ reasons: [raw] });
      expect(classifyClickHouseError(translated)).toBe(ErrorCategory.RECOVERABLE);
    });

    it("returns CRITICAL for a handled error wrapping a non-transient cause", () => {
      const translated = new QueryMemoryExceededError({
        reasons: [new Error("Syntax error in SQL")],
      });
      expect(classifyClickHouseError(translated)).toBe(ErrorCategory.CRITICAL);
    });
  });
});
