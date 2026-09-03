import { describe, expect, it, vi } from "vitest";
import type { StatementLogSink, StatementMetrics } from "../statementReporting";
import { VendorClientResilience, type VendorStatementClient } from "../vendorClient";

function recordingMetrics(): StatementMetrics & {
  durations: [string, string, number][];
  counts: [string, string][];
} {
  const durations: [string, string, number][] = [];
  const counts: [string, string][] = [];
  return {
    durations,
    counts,
    observeDuration: ({ queryType, table, durationSeconds }) =>
      void durations.push([queryType, table, durationSeconds]),
    incrementCount: ({ queryType, outcome }) => void counts.push([queryType, outcome]),
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
  const record = (level: string) => (fields: Record<string, unknown>, message: string) =>
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
  describe("given no ports at all", () => {
    describe("when a statement runs", () => {
      it("passes through to the vendor client", async () => {
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

  describe("given a metrics port", () => {
    describe("when a query succeeds", () => {
      it("counts the outcome under the statement's type and table", async () => {
        const metrics = recordingMetrics();
        const client = new VendorClientResilience({ metrics }).wrap({
          query: vi.fn().mockResolvedValue({}),
          insert: vi.fn(),
        });

        await client.query({ query: "SELECT * FROM traces", table: "traces" });

        expect(metrics.counts).toEqual([["SELECT", "success"]]);
        expect(metrics.durations).toEqual([["SELECT", "traces", expect.any(Number)]]);
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
  });

  describe("given a caller-listed transient condition", () => {
    describe("when a read fails with it and then succeeds", () => {
      it("retries and reports the recovered attempt against its cluster", async () => {
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
        // The retry notice is the only record a recovered failure leaves, so
        // it must already name the cluster that refused the attempt.
        expect(notices.lines).toEqual([
          expect.objectContaining({
            level: "warn",
            fields: expect.objectContaining({ cluster: "acme", attempt: 1 }),
          }),
        ]);
      });
    });

    describe("when a read fails with it and never recovers", () => {
      it("tries once more than the configured retries, then gives up", async () => {
        // `maxRetries` counts retries after the first try, and runWithRetry
        // counts tries, so the class converts with `maxRetries + 1`. A test
        // that only covers one failure followed by a success passes with that
        // conversion off by one in either direction; exhaustion is the only
        // shape that pins it.
        const query = vi
          .fn()
          .mockRejectedValue(
            new Error("Code: 202. DB::Exception: Too many simultaneous queries."),
          );

        const client = new VendorClientResilience({
          maxRetries: 2,
          baseDelayMs: 1,
          maxDelayMs: 1,
          transientMessageFragments: ["Too many simultaneous queries"],
        }).wrap({ query, insert: vi.fn() });

        await expect(client.query({ query: "SELECT 1" })).rejects.toThrow(
          /Too many simultaneous queries/,
        );

        expect(query).toHaveBeenCalledTimes(3);
      });
    });

    describe("when an insert fails with it", () => {
      /** @scenario Insert failures are not retried by the client */
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

        await expect(client.insert({ table: "events", values: [] })).rejects.toThrow(
          /Too many simultaneous queries/,
        );

        expect(insert).toHaveBeenCalledTimes(1);
        expect(translateQueryError).not.toHaveBeenCalled();
        expect(metrics.counts).toEqual([["INSERT", "error"]]);
        expect(metrics.durations).toEqual([["INSERT", "events", expect.any(Number)]]);
      });
    });
  });

  describe("given an error translator", () => {
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

        await expect(client.query({ query: "SELECT 1" })).rejects.toBe(translated);
        expect(translateQueryError).toHaveBeenCalledWith({
          error: expect.any(Error),
          durationMs: expect.any(Number),
        });
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
  });

  describe("given a streamed response carrying an in-band exception row", () => {
    describe("when the rows are consumed", () => {
      it("throws through the translator under a dedicated outcome", async () => {
        const metrics = recordingMetrics();
        const translateQueryError = vi.fn(({ error }: { error: unknown }) => error);
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
        // outcome for the same query, and the latency histogram is not
        // sampled twice.
        expect(metrics.counts).toEqual([
          ["SELECT", "success"],
          ["SELECT", "inband_error"],
        ]);
        expect(metrics.durations).toHaveLength(1);
      });
    });
  });

  describe("given a sole column that is merely named exception", () => {
    describe("when the rows are consumed", () => {
      it("passes them through untouched, because the signature is absent", async () => {
        const rows = [{ exception: "healthy" }, { exception: "degraded" }];
        const client = new VendorClientResilience({}).wrap(clientAnswering(rows));

        const result = (await client.query({
          query: "SELECT status AS exception FROM checks",
        })) as { json: () => Promise<unknown> };

        await expect(result.json()).resolves.toEqual(rows);
      });
    });
  });

  describe("given a cold-scan detector", () => {
    describe("when the detector names a table", () => {
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
    });

    describe("when the detector clears the statement", () => {
      it("stays at debug", async () => {
        const outcomes = recordingSink();
        const client = new VendorClientResilience({
          outcomeLogger: outcomes,
          detectColdScan: () => null,
        }).wrap({ query: vi.fn().mockResolvedValue({}), insert: vi.fn() });

        await client.query({ query: "SELECT 1" });

        expect(outcomes.lines).toEqual([expect.objectContaining({ level: "debug" })]);
      });
    });
  });

  // The rule these pin is stated on ../observability.ts: a port that only
  // describes the work must not be able to change it. Every one of these
  // reporting calls runs inside the `catch` of the wrapped statement, so an
  // unguarded throw does not merely lose a metric — it replaces the ClickHouse
  // error, and the caller never learns what actually failed.
  describe("given a reporting port that throws", () => {
    const boom = () => {
      throw new Error("metrics backend is down");
    };

    describe("when the counter throws while a read is failing", () => {
      it("raises the ClickHouse error, not the counter one", async () => {
        const translated = new Error("Code: 241. Memory limit exceeded");
        const client = new VendorClientResilience({
          metrics: { observeDuration: boom, incrementCount: boom },
          translateQueryError: ({ error }) => error,
        }).wrap({
          query: vi.fn().mockRejectedValue(translated),
          insert: vi.fn(),
        });

        await expect(client.query({ query: "SELECT 1" })).rejects.toBe(translated);
      });
    });

    describe("when the counter throws while an insert is failing", () => {
      it("raises the ClickHouse error, not the counter one", async () => {
        const failure = new Error("Code: 252. Too many parts");
        const client = new VendorClientResilience({
          metrics: { observeDuration: boom, incrementCount: boom },
        }).wrap({
          query: vi.fn(),
          insert: vi.fn().mockRejectedValue(failure),
        });

        await expect(client.insert({ table: "events" })).rejects.toBe(failure);
      });
    });

    describe("when the counter throws on the success path", () => {
      it("still returns the rows", async () => {
        const client = new VendorClientResilience({
          metrics: { observeDuration: boom, incrementCount: boom },
        }).wrap({
          query: vi.fn().mockResolvedValue({ ok: true }),
          insert: vi.fn(),
        });

        await expect(client.query({ query: "SELECT 1" })).resolves.toEqual({
          ok: true,
        });
      });
    });

    describe("when one broken metric sits beside a working one", () => {
      it("still records the one that works", async () => {
        const counts: [string, string][] = [];
        const client = new VendorClientResilience({
          metrics: {
            observeDuration: boom,
            incrementCount: ({ queryType, outcome }) =>
              void counts.push([queryType, outcome]),
          },
        }).wrap({
          query: vi.fn().mockResolvedValue({}),
          insert: vi.fn(),
        });

        await client.query({ query: "SELECT 1" });

        expect(counts).toEqual([["SELECT", "success"]]);
      });
    });

    describe("when one broken logger is passed for both sinks", () => {
      it("raises the ClickHouse error, not the second logging failure", async () => {
        // The fallback that reports a failed outcome line writes to the notice
        // sink. A host passing one logger for both has already broken the sink
        // being asked to report the breakage, so the fallback throws too.
        const broken: StatementLogSink = {
          debug: boom,
          warn: boom,
          error: boom,
        };
        const failure = new Error("Code: 241. Memory limit exceeded");
        const client = new VendorClientResilience({
          noticeLogger: broken,
          outcomeLogger: broken,
          translateQueryError: ({ error }) => error,
        }).wrap({
          query: vi.fn().mockRejectedValue(failure),
          insert: vi.fn(),
        });

        await expect(client.query({ query: "SELECT 1" })).rejects.toBe(failure);
      });

      /** @scenario Logging crashes do not affect query results */
      it("still returns the rows when the success line throws", async () => {
        const broken: StatementLogSink = {
          debug: boom,
          warn: boom,
          error: boom,
        };
        const client = new VendorClientResilience({
          noticeLogger: broken,
          outcomeLogger: broken,
        }).wrap({
          query: vi.fn().mockResolvedValue({ ok: true }),
          insert: vi.fn(),
        });

        await expect(client.query({ query: "SELECT 1" })).resolves.toEqual({
          ok: true,
        });
      });
    });
  });

  describe("given an insert that fails with a non-transient error", () => {
    describe("when it is issued", () => {
      /** @scenario Non-transient insert errors fail immediately */
      it("is not retried and emits a structured error log", async () => {
        const outcomes = recordingSink();
        const failure = new Error("Code: 62. Syntax error");
        const insert = vi.fn().mockRejectedValue(failure);

        const client = new VendorClientResilience({
          maxRetries: 2,
          baseDelayMs: 1,
          maxDelayMs: 1,
          outcomeLogger: outcomes,
        }).wrap({ query: vi.fn(), insert });

        await expect(client.insert({ table: "events", values: [] })).rejects.toBe(failure);

        expect(insert).toHaveBeenCalledTimes(1);
        expect(outcomes.lines).toHaveLength(1);
        expect(outcomes.lines[0]).toMatchObject({
          level: "warn",
          fields: expect.objectContaining({ operation: "insert" }),
        });
      });
    });
  });

  describe("given a vendor client with methods beyond query and insert", () => {
    describe("when a non-query method is called on the wrapped client", () => {
      /** @scenario Non-query operations pass through to the underlying client */
      it("delegates directly to the underlying client without interception", async () => {
        const close = vi.fn().mockResolvedValue(undefined);
        const command = vi.fn().mockResolvedValue({ ok: true });
        const raw = { query: vi.fn(), insert: vi.fn(), close, command };

        const wrapped = new VendorClientResilience().wrap(raw);

        expect(wrapped.close).toBe(close);
        expect(wrapped.command).toBe(command);
        await wrapped.close();
        await wrapped.command();
        expect(close).toHaveBeenCalledTimes(1);
        expect(command).toHaveBeenCalledTimes(1);
      });
    });
  });
});
