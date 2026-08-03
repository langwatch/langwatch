import type { ClickHouseClient } from "@clickhouse/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockObserveQueryDuration = vi.fn();
const mockIncrementQueryCount = vi.fn();

vi.mock("~/server/clickhouse/metrics", () => ({
  observeClickHouseQueryDuration: (...args: unknown[]) =>
    mockObserveQueryDuration(...args),
  incrementClickHouseQueryCount: (...args: unknown[]) =>
    mockIncrementQueryCount(...args),
}));

// Must import after mock setup
import { createResilientClickHouseClient } from "../resilient-client";

/**
 * ClickHouse streams over HTTP: an error after the first flushed row cannot
 * change the 200 status, so the server appends `{"exception": "..."}` to the
 * output instead. Left unread, that line reaches a decoder as a "row" with
 * none of the selected columns. These tests pin both halves of the guard —
 * such a line is surfaced as a thrown error carrying the real ClickHouse
 * message, and a legitimate result whose sole column happens to be named
 * `exception` is passed through untouched.
 */
describe("createResilientClickHouseClient()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function clientAnswering(rows: unknown[]): ClickHouseClient {
    return {
      query: vi.fn().mockResolvedValue({
        response_headers: {},
        json: vi.fn().mockResolvedValue(rows),
      }),
      insert: vi.fn(),
    } as unknown as ClickHouseClient;
  }

  describe("when a streamed response carries an in-band exception row", () => {
    it("throws through the translator so the incident shape lands as a typed error", async () => {
      const exceptionText =
        "Code: 241. DB::Exception: Query memory limit exceeded: would use 9.99 GiB, maximum: 9.50 GiB: While executing ReplacingSorted. (MEMORY_LIMIT_EXCEEDED)";
      const wrapper = createResilientClickHouseClient({
        client: clientAnswering([
          { SeriesId: "s1", BucketCounts: [] },
          { exception: exceptionText },
        ]),
      });

      const result = await wrapper.query({ query: "SELECT 1" } as never);

      // Assert on code, not message prose — the code is the stable contract.
      await expect(result.json()).rejects.toMatchObject({
        code: "query_memory_exceeded",
      });
    });

    it("throws a plain error carrying the ClickHouse text for untranslated codes", async () => {
      const wrapper = createResilientClickHouseClient({
        client: clientAnswering([
          { exception: "Code: 999. DB::Exception: some future failure" },
        ]),
      });

      const result = await wrapper.query({ query: "SELECT 1" } as never);

      await expect(result.json()).rejects.toThrow(
        /Code: 999\. DB::Exception: some future failure/,
      );
    });

    it("throws for exception subclasses that print their own class name", async () => {
      const wrapper = createResilientClickHouseClient({
        client: clientAnswering([
          {
            exception:
              "Code: 210. DB::NetException: Connection reset by peer. (NETWORK_ERROR)",
          },
        ]),
      });

      const result = await wrapper.query({ query: "SELECT 1" } as never);

      await expect(result.json()).rejects.toThrow(/DB::NetException/);
    });

    it("records a dedicated in-band outcome without double-counting", async () => {
      const wrapper = createResilientClickHouseClient({
        client: clientAnswering([
          { exception: "Code: 241. DB::Exception: memory" },
        ]),
      });

      const result = await wrapper.query({ query: "SELECT 1" } as never);
      // Transport-level success is recorded when the query resolves — a
      // caller may stream() or never consume, so that cannot be deferred.
      expect(mockIncrementQueryCount).toHaveBeenCalledWith("SELECT", "success");
      expect(mockObserveQueryDuration).toHaveBeenCalledTimes(1);

      await expect(result.json()).rejects.toThrow();

      // The failure lands under its own outcome, never as a second terminal
      // outcome for the same query, and the latency histogram is not
      // sampled twice.
      expect(mockIncrementQueryCount).toHaveBeenCalledWith(
        "SELECT",
        "inband_error",
      );
      expect(mockIncrementQueryCount).not.toHaveBeenCalledWith(
        "SELECT",
        "error",
      );
      expect(mockObserveQueryDuration).toHaveBeenCalledTimes(1);
    });
  });

  describe("when a legitimate single-column result is named exception", () => {
    it("returns the rows untouched", async () => {
      // Sole key, but no ClickHouse error signature — this is data, not the
      // server's exception line, and rejecting it would break the query.
      const rows = [{ exception: "healthy" }, { exception: "degraded" }];
      const wrapper = createResilientClickHouseClient({
        client: clientAnswering(rows),
      });

      const result = await wrapper.query({
        query: "SELECT status AS exception FROM checks",
      } as never);

      await expect(result.json()).resolves.toEqual(rows);
    });
  });

  describe("when a legitimate row merely has a column named exception", () => {
    it("returns the rows untouched", async () => {
      const rows = [
        { exception: "a real column value", other: 1 },
        { exception: "another", other: 2 },
      ];
      const wrapper = createResilientClickHouseClient({
        client: clientAnswering(rows),
      });

      const result = await wrapper.query({ query: "SELECT 1" } as never);

      await expect(result.json()).resolves.toEqual(rows);
    });
  });

  describe("when the response has no exception row", () => {
    it("returns the rows untouched", async () => {
      const rows = [{ a: 1 }, { a: 2 }];
      const wrapper = createResilientClickHouseClient({
        client: clientAnswering(rows),
      });

      const result = await wrapper.query({ query: "SELECT 1" } as never);

      await expect(result.json()).resolves.toEqual(rows);
    });
  });
});
