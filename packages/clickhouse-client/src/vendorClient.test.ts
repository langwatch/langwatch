import { describe, expect, it, vi } from "vitest";
import {
  type StatementLogSink,
  type StatementMetrics,
  VendorClientResilience,
  type VendorStatementClient,
} from "./vendorClient";

function recordingMetrics(): StatementMetrics & {
  durations: [string, string, number][];
  counts: [string, string][];
} {
  const durations: [string, string, number][] = [];
  const counts: [string, string][] = [];
  return {
    durations,
    counts,
    observeDuration: (queryType, table, seconds) =>
      void durations.push([queryType, table, seconds]),
    incrementCount: (queryType, outcome) =>
      void counts.push([queryType, outcome]),
  };
}

function recordingSink(): StatementLogSink & {
  lines: { level: string; fields: Record<string, unknown>; message: string }[];
} {
  const lines: {
    level: string;
    fields: Record<string, unknown>;
    message: string;
  }[] = [];
  const record =
    (level: string) => (fields: Record<string, unknown>, message: string) =>
      void lines.push({ level, fields, message });
  return {
    lines,
    debug: record("debug"),
    warn: record("warn"),
    error: record("error"),
  };
}

function clientAnswering(rows: unknown[]): VendorStatementClient {
  return {
    query: vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue(rows),
    }),
    insert: vi.fn(),
  };
}

describe("VendorClientResilience", () => {
  describe("when a query succeeds", () => {
    it("counts the outcome under the statement's type and table", async () => {
      const metrics = recordingMetrics();
      const client = new VendorClientResilience({ metrics }).wrap({
        query: vi.fn().mockResolvedValue({}),
        insert: vi.fn(),
      });

      await client.query({ query: "SELECT * FROM traces", table: "traces" });

      expect(metrics.counts).toEqual([["SELECT", "success"]]);
      expect(metrics.durations).toEqual([
        ["SELECT", "traces", expect.any(Number)],
      ]);
    });

    it("classifies WITH as a read and unparseable params as OTHER", async () => {
      const metrics = recordingMetrics();
      const client = new VendorClientResilience({ metrics }).wrap({
        query: vi.fn().mockResolvedValue({}),
        insert: vi.fn(),
      });

      await client.query({ query: "WITH x AS (SELECT 1) SELECT * FROM x" });
      await client.query(undefined);

      expect(metrics.counts).toEqual([
        ["SELECT", "success"],
        ["OTHER", "success"],
      ]);
    });
  });

  describe("when a read fails with a caller-listed transient condition", () => {
    it("retries under one slot of the shared policy and then succeeds", async () => {
      const metrics = recordingMetrics();
      const notices = recordingSink();
      const query = vi
        .fn()
        .mockRejectedValueOnce(
          new Error("Code: 202. DB::Exception: Too many simultaneous queries."),
        )
        .mockResolvedValueOnce({});

      const client = new VendorClientResilience({
        cluster: "acme",
        maxRetries: 2,
        baseDelayMs: 1,
        maxDelayMs: 1,
        transientMessageFragments: ["Too many simultaneous queries"],
        metrics,
        noticeLogger: notices,
      }).wrap({ query, insert: vi.fn() });

      await client.query({ query: "SELECT 1" });

      expect(query).toHaveBeenCalledTimes(2);
      expect(metrics.counts).toEqual([["SELECT", "success"]]);
      // The retry notice is the only record a recovered failure leaves, so it
      // must already name the cluster that refused the attempt.
      expect(notices.lines).toEqual([
        expect.objectContaining({
          level: "warn",
          fields: expect.objectContaining({ cluster: "acme", attempt: 1 }),
        }),
      ]);
    });
  });

  describe("when a read fails permanently", () => {
    it("raises through the translator and counts the error", async () => {
      const metrics = recordingMetrics();
      const outcomes = recordingSink();
      const translated = new Error("translated");
      const translateQueryError = vi.fn().mockReturnValue(translated);

      const client = new VendorClientResilience({
        cluster: "acme",
        metrics,
        outcomeLogger: outcomes,
        translateQueryError,
      }).wrap({
        query: vi.fn().mockRejectedValue(new Error("Syntax error")),
        insert: vi.fn(),
      });

      await expect(client.query({ query: "SELECT 1" })).rejects.toBe(
        translated,
      );
      expect(translateQueryError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.any(Number),
      );
      expect(metrics.counts).toEqual([["SELECT", "error"]]);
      expect(outcomes.lines).toEqual([
        expect.objectContaining({
          level: "warn",
          message: "ClickHouse query failed",
          fields: expect.objectContaining({ cluster: "acme" }),
        }),
      ]);
    });
  });

  describe("when an insert fails with the same transient condition", () => {
    it("does not retry and raises the error untranslated", async () => {
      const metrics = recordingMetrics();
      const translateQueryError = vi.fn();
      const insert = vi
        .fn()
        .mockRejectedValue(
          new Error("Code: 202. DB::Exception: Too many simultaneous queries."),
        );

      const client = new VendorClientResilience({
        maxRetries: 2,
        baseDelayMs: 1,
        maxDelayMs: 1,
        transientMessageFragments: ["Too many simultaneous queries"],
        metrics,
        translateQueryError,
      }).wrap({ query: vi.fn(), insert });

      await expect(
        client.insert({ table: "events", values: [] }),
      ).rejects.toThrow(/Too many simultaneous queries/);

      expect(insert).toHaveBeenCalledTimes(1);
      expect(translateQueryError).not.toHaveBeenCalled();
      expect(metrics.counts).toEqual([["INSERT", "error"]]);
      expect(metrics.durations).toEqual([
        ["INSERT", "events", expect.any(Number)],
      ]);
    });
  });

  describe("when a streamed response carries an in-band exception row", () => {
    it("throws through the translator under a dedicated outcome", async () => {
      const metrics = recordingMetrics();
      const translateQueryError = vi.fn((error: unknown) => error);
      const client = new VendorClientResilience({
        metrics,
        translateQueryError,
      }).wrap(
        clientAnswering([
          { SeriesId: "s1" },
          {
            exception:
              "Code: 241. DB::Exception: Memory limit exceeded. (MEMORY_LIMIT_EXCEEDED)",
          },
        ]),
      );

      const result = (await client.query({ query: "SELECT 1" })) as {
        json: () => Promise<unknown>;
      };
      // Transport-level success is recorded when the query resolves — a
      // caller may stream() or never consume, so that cannot be deferred.
      expect(metrics.counts).toEqual([["SELECT", "success"]]);

      await expect(result.json()).rejects.toMatchObject({ code: "241" });

      expect(translateQueryError).toHaveBeenCalledTimes(1);
      // The failure lands under its own outcome, never as a second terminal
      // outcome for the same query, and the latency histogram is not sampled
      // twice.
      expect(metrics.counts).toEqual([
        ["SELECT", "success"],
        ["SELECT", "inband_error"],
      ]);
      expect(metrics.durations).toHaveLength(1);
    });

    it("passes a sole exception column through when it lacks the signature", async () => {
      const rows = [{ exception: "healthy" }, { exception: "degraded" }];
      const client = new VendorClientResilience({}).wrap(
        clientAnswering(rows),
      );

      const result = (await client.query({
        query: "SELECT status AS exception FROM checks",
      })) as { json: () => Promise<unknown> };

      await expect(result.json()).resolves.toEqual(rows);
    });
  });

  describe("when the host's detector names a cold-scan table", () => {
    it("warns with the table and a query preview instead of the debug line", async () => {
      const outcomes = recordingSink();
      const client = new VendorClientResilience({
        outcomeLogger: outcomes,
        detectColdScan: () => "trace_summaries",
      }).wrap({ query: vi.fn().mockResolvedValue({}), insert: vi.fn() });

      await client.query({ query: "SELECT * FROM trace_summaries" });

      expect(outcomes.lines).toEqual([
        expect.objectContaining({
          level: "warn",
          fields: expect.objectContaining({
            coldScan: true,
            coldScanTable: "trace_summaries",
            query: "SELECT * FROM trace_summaries",
          }),
        }),
      ]);
    });

    it("stays at debug for statements the detector clears", async () => {
      const outcomes = recordingSink();
      const client = new VendorClientResilience({
        outcomeLogger: outcomes,
        detectColdScan: () => null,
      }).wrap({ query: vi.fn().mockResolvedValue({}), insert: vi.fn() });

      await client.query({ query: "SELECT 1" });

      expect(outcomes.lines).toEqual([
        expect.objectContaining({ level: "debug" }),
      ]);
    });
  });

  describe("when no ports are given", () => {
    it("still runs the statement as a plain pass-through", async () => {
      const client = new VendorClientResilience().wrap({
        query: vi.fn().mockResolvedValue({ ok: true }),
        insert: vi.fn().mockResolvedValue({ ok: true }),
      });

      await expect(client.query({ query: "SELECT 1" })).resolves.toEqual({
        ok: true,
      });
      await expect(client.insert({ table: "t" })).resolves.toEqual({
        ok: true,
      });
    });
  });
});
