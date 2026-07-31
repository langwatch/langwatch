import { describe, expect, it, vi } from "vitest";
import {
  decideRetry,
  isTransientTransportError,
  type Operation,
} from "./retryPolicy";

function connectionResetError(): Error {
  const error = new Error("socket hang up") as NodeJS.ErrnoException;
  error.code = "ECONNRESET";
  return error;
}

function gatewayError(status: number): Error {
  const error = new Error(`upstream error ${status}`) as Error & {
    statusCode: number;
  };
  error.statusCode = status;
  return error;
}

function memoryLimitExceededError(): Error {
  const error = new Error("Memory limit exceeded") as NodeJS.ErrnoException;
  error.code = "241";
  return error;
}

function timeoutExceededError(): Error {
  const error = new Error("Timeout exceeded") as NodeJS.ErrnoException;
  error.code = "159";
  return error;
}

const SELECT: Operation = { kind: "select" };
const DDL: Operation = { kind: "ddl" };
const INSERT_REPLACING: Operation = {
  kind: "insert",
  target: { kind: "replacing" },
};
const INSERT_APPEND_NO_IDENTITY: Operation = {
  kind: "insert",
  target: { kind: "append", perRecordIdentity: false },
};
const INSERT_APPEND_WITH_IDENTITY: Operation = {
  kind: "insert",
  target: { kind: "append", perRecordIdentity: true },
};
const INSERT_AGGREGATING: Operation = {
  kind: "insert",
  target: { kind: "aggregating" },
};

describe("given isTransientTransportError()", () => {
  describe("when the failure never reached a working server", () => {
    it("classifies a connection reset as transient", () => {
      expect(isTransientTransportError(connectionResetError())).toBe(true);
    });

    it("classifies a 502/503/504 gateway error as transient", () => {
      expect(isTransientTransportError(gatewayError(502))).toBe(true);
      expect(isTransientTransportError(gatewayError(503))).toBe(true);
      expect(isTransientTransportError(gatewayError(504))).toBe(true);
    });
  });

  describe("when the failure is a deterministic server-side outcome", () => {
    it("does not classify a memory-limit exception as transient", () => {
      expect(isTransientTransportError(memoryLimitExceededError())).toBe(false);
    });

    it("does not classify a timeout-exceeded exception as transient", () => {
      expect(isTransientTransportError(timeoutExceededError())).toBe(false);
    });

    it("does not classify an arbitrary gateway status as transient", () => {
      expect(isTransientTransportError(gatewayError(400))).toBe(false);
    });
  });

  describe("when the thrown value is not an Error", () => {
    it("does not classify a plain string as transient", () => {
      expect(isTransientTransportError("boom")).toBe(false);
    });
  });
});

describe("given decideRetry()", () => {
  describe("when a select hits a transient transport failure", () => {
    /** @scenario a select is never retried by the client */
    it("does not retry, because only inserts are retried", () => {
      const decision = decideRetry({
        operation: SELECT,
        error: connectionResetError(),
        attempt: 1,
      });
      expect(decision).toEqual({
        retry: false,
        reason: expect.any(String),
      });
    });
  });

  describe("when a select hits a memory-limit exception", () => {
    it("does not retry, because the same query would exhaust memory again", () => {
      const decision = decideRetry({
        operation: SELECT,
        error: memoryLimitExceededError(),
        attempt: 1,
      });
      expect(decision).toEqual({
        retry: false,
        reason: expect.any(String),
      });
    });
  });

  describe("when a select has attempts left in the budget", () => {
    it("still does not retry, because the refusal is structural rather than budgeted", () => {
      const decision = decideRetry({
        operation: SELECT,
        error: connectionResetError(),
        attempt: 1,
        maxAttempts: 10,
      });
      expect(decision.retry).toBe(false);
    });
  });

  describe("when an insert into a replacing table hits a transient failure", () => {
    /** @scenario a replace write is retryable because the version column resolves a duplicate */
    it("retries, because a duplicate collapses at merge", () => {
      const decision = decideRetry({
        operation: INSERT_REPLACING,
        error: connectionResetError(),
        attempt: 1,
      });
      expect(decision.retry).toBe(true);
    });
  });

  describe("when an insert into an append table without per-record identity hits a transient failure", () => {
    /** @scenario an append write is retryable only when its sort key carries per-record identity */
    it("does not retry, because a duplicate would land as a second row", () => {
      const decision = decideRetry({
        operation: INSERT_APPEND_NO_IDENTITY,
        error: connectionResetError(),
        attempt: 1,
      });
      expect(decision.retry).toBe(false);
    });
  });

  describe("when an insert into an append table with per-record identity hits a transient failure", () => {
    /** @scenario an append write is retryable only when its sort key carries per-record identity */
    it("retries, because a duplicate lands on the same key and collapses", () => {
      const decision = decideRetry({
        operation: INSERT_APPEND_WITH_IDENTITY,
        error: connectionResetError(),
        attempt: 1,
      });
      expect(decision.retry).toBe(true);
    });
  });

  describe("when an insert into an aggregating table hits a transient failure", () => {
    /** @scenario an aggregating write is never retried */
    it("never retries, because the engine adds and a duplicate corrupts the aggregate", () => {
      const decision = decideRetry({
        operation: INSERT_AGGREGATING,
        error: connectionResetError(),
        attempt: 1,
      });
      expect(decision.retry).toBe(false);
    });
  });

  describe("when a ddl operation hits a transient failure", () => {
    it("never retries", () => {
      const decision = decideRetry({
        operation: DDL,
        error: connectionResetError(),
        attempt: 1,
      });
      expect(decision.retry).toBe(false);
    });
  });

  describe("when the retry budget is already spent", () => {
    it("stops retrying once the attempt count reaches maxAttempts", () => {
      const decision = decideRetry({
        operation: INSERT_REPLACING,
        error: connectionResetError(),
        attempt: 3,
        maxAttempts: 3,
      });
      expect(decision.retry).toBe(false);
    });
  });

  // Backoff is only ever observable on an insert now, since it is the only
  // operation that reaches the delay calculation at all.
  describe("given repeated backoff decisions", () => {
    it("grows the delay ceiling with the attempt number", () => {
      const randomSpy = vi.spyOn(Math, "random").mockReturnValue(1);
      try {
        const early = decideRetry({
          operation: INSERT_REPLACING,
          error: connectionResetError(),
          attempt: 1,
        });
        const later = decideRetry({
          operation: INSERT_REPLACING,
          error: connectionResetError(),
          attempt: 3,
        });
        if (!early.retry || !later.retry) {
          throw new Error("expected both decisions to retry");
        }
        expect(later.afterMs).toBeGreaterThan(early.afterMs);
        expect(early.afterMs).toBeLessThanOrEqual(10_000);
        expect(later.afterMs).toBeLessThanOrEqual(10_000);
      } finally {
        randomSpy.mockRestore();
      }
    });

    it("jitters the delay rather than returning a fixed value for the same attempt", () => {
      const seen = new Set<number>();
      for (let i = 0; i < 25; i++) {
        const decision = decideRetry({
          operation: INSERT_REPLACING,
          error: connectionResetError(),
          attempt: 1,
        });
        if (decision.retry) seen.add(decision.afterMs);
      }
      expect(seen.size).toBeGreaterThan(1);
    });
  });
});
