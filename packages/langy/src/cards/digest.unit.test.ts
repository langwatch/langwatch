/**
 * The digest extractor, pinned against the CLI's REAL `--format json` output
 * shapes (grounded on the command implementations in `typescript-sdk/src/cli`):
 * trace search wraps in `{ traces, pagination.totalHits }`, dataset list in
 * `{ data, pagination.total }`, prompt/evaluator/scenario lists are bare
 * arrays, experiment status is a single run document, analytics is a
 * timeseries. One convention extractor must read them all.
 */
import { describe, expect, it } from "vitest";
import { extractDigest, MAX_DIGEST_IDS } from "./digest.js";

describe("extractDigest, given a collection read", () => {
  describe("when a trace search returns matches (traces + pagination.totalHits)", () => {
    const output = JSON.stringify({
      traces: [
        { trace_id: "trace_1", input: { value: "hi" } },
        { trace_id: "trace_2", input: { value: "yo" } },
      ],
      pagination: { totalHits: 34 },
    });

    it("references the traces by id with honest counts", () => {
      const digest = extractDigest({
        resource: "trace",
        verb: "search",
        args: { query: "checkout failed", limit: "25" },
        output,
      });

      expect(digest).toEqual({
        resource: "trace",
        verb: "search",
        strategy: "id-ref",
        ids: ["trace_1", "trace_2"],
        counts: { returned: 2, total: 34 },
        query: { query: "checkout failed", limit: "25" },
      });
    });

    it("reads the trace id however the serialiser spelled it (ref hint)", () => {
      const digest = extractDigest({
        resource: "trace",
        verb: "search",
        output: JSON.stringify({
          traces: [{ traceId: "trace_camel" }],
          pagination: { totalHits: 1 },
        }),
      });
      expect(digest.ids).toEqual(["trace_camel"]);
    });
  });

  describe("when a dataset list returns rows (data + pagination.total)", () => {
    it("references the datasets by slug", () => {
      const digest = extractDigest({
        resource: "dataset",
        verb: "list",
        output: JSON.stringify({
          data: [
            { slug: "golden-set", name: "Golden set", recordCount: 120 },
            { slug: "edge-cases", name: "Edge cases", recordCount: 8 },
          ],
          pagination: { total: 9, page: 1, totalPages: 5 },
        }),
      });

      expect(digest.strategy).toBe("id-ref");
      expect(digest.ids).toEqual(["golden-set", "edge-cases"]);
      expect(digest.counts).toEqual({ returned: 2, total: 9 });
    });
  });

  describe("when a prompt list returns a bare array", () => {
    it("references the prompts by id", () => {
      const digest = extractDigest({
        resource: "prompt",
        verb: "list",
        output: JSON.stringify([
          { id: "prompt_1", handle: "support/greeting", version: 3 },
          { id: "prompt_2", handle: "support/refund", version: 1 },
        ]),
      });

      expect(digest.strategy).toBe("id-ref");
      expect(digest.ids).toEqual(["prompt_1", "prompt_2"]);
      expect(digest.counts).toEqual({ returned: 2, total: 2 });
    });
  });

  describe("when the result carries more ids than a reference should", () => {
    it("caps the ids and keeps the honest counts", () => {
      const rows = Array.from({ length: 40 }, (_, i) => ({ id: `row_${i}` }));
      const digest = extractDigest({
        resource: "evaluator",
        verb: "list",
        output: JSON.stringify(rows),
      });

      expect(digest.ids).toHaveLength(MAX_DIGEST_IDS);
      expect(digest.counts).toEqual({ returned: 40, total: 40 });
    });
  });

  describe("when a reduced result carries the in-band truncation marker", () => {
    it("skips the marker — it is not a row and never counts as one", () => {
      const digest = extractDigest({
        resource: "trace",
        verb: "search",
        output: JSON.stringify({
          traces: [
            { trace_id: "trace_1" },
            "… 40 more items truncated",
          ],
          pagination: { totalHits: 41 },
        }),
      });

      expect(digest.ids).toEqual(["trace_1"]);
      expect(digest.counts).toEqual({ returned: 1, total: 41 });
    });
  });
});

describe("extractDigest, given a single-resource read", () => {
  describe("when a dataset get returns the document", () => {
    it("references the one resource, with its name", () => {
      const digest = extractDigest({
        resource: "dataset",
        verb: "get",
        output: JSON.stringify({
          id: "ds_1",
          slug: "golden-set",
          name: "Golden set",
          columnTypes: [{ name: "input", type: "string" }],
        }),
      });

      expect(digest.strategy).toBe("id-ref");
      expect(digest.primaryId).toBe("ds_1");
      expect(digest.ids).toEqual(["ds_1"]);
      expect(digest.name).toBe("Golden set");
    });
  });

  describe("when an experiment status reports a run (runId, no id)", () => {
    it("references the run by its runId (run-kind convention)", () => {
      const digest = extractDigest({
        resource: "experiment",
        verb: "status",
        output: JSON.stringify({
          runId: "run_9",
          status: "completed",
          progress: 40,
          total: 40,
        }),
      });

      expect(digest.strategy).toBe("id-ref");
      expect(digest.primaryId).toBe("run_9");
    });
  });
});

describe("extractDigest, given an aggregate", () => {
  describe("when an analytics query returns a timeseries", () => {
    it("stores the query, not the rolled-up rows — the card re-runs it", () => {
      const digest = extractDigest({
        resource: "analytics",
        verb: "query",
        args: { metric: "trace-count", "start-date": "1720000000000" },
        output: JSON.stringify({
          currentPeriod: [{ date: "2026-07-14", "trace-count": 12 }],
          previousPeriod: [{ date: "2026-07-13", "trace-count": 7 }],
        }),
      });

      expect(digest.strategy).toBe("query-ref");
      expect(digest.query).toEqual({
        metric: "trace-count",
        "start-date": "1720000000000",
      });
      expect(digest.ids).toBeUndefined();
      expect(digest.reduced).toBeUndefined();
    });
  });
});

describe("extractDigest, given output that parses but names nothing fetchable", () => {
  it("keeps the structure for the card to render (reduced tier)", () => {
    const document = { rateLimits: { rpm: 60 }, enforcement: "strict" };
    const digest = extractDigest({
      resource: "governance",
      verb: "status",
      output: JSON.stringify(document),
    });

    expect(digest.strategy).toBe("reduced");
    expect(digest.reduced).toEqual(document);
  });
});

describe("extractDigest, given output that is not a JSON document", () => {
  it("degrades to the text tier, keeping resource, verb and query", () => {
    const digest = extractDigest({
      resource: "trace",
      verb: "search",
      args: { query: "hi" },
      output: "Trace ID   Input\ntrace_1    hi",
    });

    expect(digest).toEqual({
      resource: "trace",
      verb: "search",
      strategy: "text",
      query: { query: "hi" },
    });
  });

  it("finds the document behind the CLI's spinner noise", () => {
    const digest = extractDigest({
      resource: "trace",
      verb: "search",
      output:
        '- Searching traces...\n✔ Found 1 traces\n{"traces":[{"trace_id":"trace_1"}],"pagination":{"totalHits":1}}\nUse langwatch trace get <traceId> for details',
    });

    expect(digest.strategy).toBe("id-ref");
    expect(digest.ids).toEqual(["trace_1"]);
  });
});
