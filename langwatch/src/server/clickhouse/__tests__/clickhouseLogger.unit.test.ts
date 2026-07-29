import { beforeEach, describe, expect, it, vi } from "vitest";

const { warn, error, info, debug } = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ warn, error, info, debug }),
}));

import { ClickHouseLogger } from "../clickhouseLogger";

/**
 * `specs/clickhouse/query-attribution.feature` — "a retried attempt is not
 * reported as a failure".
 *
 * The driver calls its logger's `error` from `logRequestError` for EVERY failed
 * HTTP attempt, before anything decides whether the attempt is fatal. Our
 * resilient client retries transient failures, so most of those attempts are
 * recovered and never reach a caller. Left at error level they were the single
 * largest source of ERROR-severity lines in production while the underlying
 * query failure rate was a rounding error.
 *
 * Nothing is lost: a query that fails after its retries are exhausted is logged
 * at error by the resilient client's own `logFailure`.
 */
describe("ClickHouseLogger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when the driver reports a failed HTTP attempt", () => {
    it("records it as a retry rather than an error", () => {
      new ClickHouseLogger().error({
        module: "Query",
        message: "Query: HTTP request error.",
        args: { operation: "Query" },
        err: new Error("socket hang up"),
      } as never);

      expect(error).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ module: "Query" }),
        "Query: HTTP request error.",
      );
    });

    it("keeps the driver's own context on the record", () => {
      const err = new Error("socket hang up");
      new ClickHouseLogger().error({
        module: "Insert",
        message: "Insert: HTTP request error.",
        args: { connection_id: 7, query_id: "q-1" },
        err,
      } as never);

      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          module: "Insert",
          connection_id: 7,
          query_id: "q-1",
          error: err,
        }),
        "Insert: HTTP request error.",
      );
    });
  });

  describe("when the driver logs at its own warn level", () => {
    it("passes it through unchanged", () => {
      new ClickHouseLogger().warn({
        module: "Client",
        message: "something worth noting",
        args: {},
      } as never);

      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ module: "Client" }),
        "something worth noting",
      );
    });
  });
});
