import { describe, expect, it, vi } from "vitest";
import type { SpanInsertData } from "../../types";
import {
  deserializeAttributes,
  mapSpanSummaryRow,
  SpanStorageClickHouseRepository,
  type SpanSummaryQueryRow,
  serializeAttributes,
} from "../span-storage.clickhouse.repository";
import {
  clampSpanReadLimit,
  MAX_DERIVATION_SPANS,
  MAX_LIGHT_SPAN_READ_ROWS,
} from "../span-storage.repository";

// A lone (unpaired) UTF-16 surrogate half — the shape a string takes when it is
// truncated mid-emoji or an SDK captured binary/garbage text. `JSONEachRow`
// serialises it as a `\uD83D`-style escape with no second part, which is what
// ClickHouse's JSON parser rejects ("missing second part of surrogate pair"),
// dead-lettering the span forever.
const LONE_HIGH_SURROGATE = "\uD83D";
const LONE_LOW_SURROGATE = "\uDC00";

/** Recursively collects every string (object keys included) from a value. */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      out.push(key);
      collectStrings(val, out);
    }
  }
  return out;
}

describe("serializeAttributes", () => {
  describe("when given string values", () => {
    it("passes strings through unchanged", () => {
      const result = serializeAttributes({ key: "hello" });
      expect(result).toEqual({ key: "hello" });
    });
  });

  describe("when given numeric values", () => {
    it("stringifies numbers", () => {
      const result = serializeAttributes({ count: 42, float: 3.14 });
      expect(result).toEqual({ count: "42", float: "3.14" });
    });
  });

  describe("when given boolean values", () => {
    it("stringifies booleans", () => {
      const result = serializeAttributes({ flag: true, off: false });
      expect(result).toEqual({ flag: "true", off: "false" });
    });
  });

  describe("when given bigint values", () => {
    it("stringifies bigints", () => {
      const result = serializeAttributes({ big: BigInt(9007199254740991) });
      expect(result).toEqual({ big: "9007199254740991" });
    });
  });

  describe("when given object values", () => {
    it("JSON-stringifies objects", () => {
      const result = serializeAttributes({ data: { nested: true } });
      expect(result).toEqual({ data: '{"nested":true}' });
    });

    it("JSON-stringifies arrays", () => {
      const result = serializeAttributes({ items: [1, 2, 3] });
      expect(result).toEqual({ items: "[1,2,3]" });
    });
  });

  describe("when given null or undefined values", () => {
    it("skips null values", () => {
      const result = serializeAttributes({ key: null });
      expect(result).toEqual({});
    });

    it("skips undefined values", () => {
      const result = serializeAttributes({ key: undefined });
      expect(result).toEqual({});
    });
  });

  describe("when given unserializable values", () => {
    it("skips values with circular references", () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      const result = serializeAttributes({ ok: "yes", bad: circular });
      expect(result).toEqual({ ok: "yes" });
    });
  });

  describe("given an attribute key or value with a lone UTF-16 surrogate", () => {
    describe("when serializing for the ClickHouse write boundary", () => {
      it("replaces a lone surrogate in a string value with U+FFFD", () => {
        const result = serializeAttributes({
          key: `bad${LONE_HIGH_SURROGATE}`,
        });
        expect(result.key!.isWellFormed()).toBe(true);
        expect(result.key).toBe("bad�");
      });

      it("replaces a lone surrogate in a map key with U+FFFD", () => {
        const result = serializeAttributes({
          [`k${LONE_LOW_SURROGATE}`]: "value",
        });
        const keys = Object.keys(result);
        expect(keys).toHaveLength(1);
        expect(keys[0]!.isWellFormed()).toBe(true);
        expect(keys[0]).toBe("k�");
      });

      it("produces keys and values that survive a JSON encode/decode round-trip well-formed", () => {
        // JSONEachRow encodes the map with JSON; a strict consumer (ClickHouse)
        // decodes it. A lone surrogate would survive the encode as a `\uXXXX`
        // escape and blow up the decode — sanitising leaves nothing to reject.
        const result = serializeAttributes({
          [`k${LONE_HIGH_SURROGATE}`]: `v${LONE_LOW_SURROGATE}`,
        });
        const reparsed = JSON.parse(JSON.stringify(result)) as Record<
          string,
          string
        >;
        for (const [key, value] of Object.entries(reparsed)) {
          expect(key.isWellFormed()).toBe(true);
          expect(value.isWellFormed()).toBe(true);
        }
      });

      it("emits a well-formed map value when a lone surrogate is nested inside a JSON-serialized object", () => {
        // `JSON.stringify` escapes the lone surrogate to a literal `\uXXXX`
        // sequence, so the map-value string handed to ClickHouse carries no
        // lone surrogate code unit — and the outer JSONEachRow encode
        // double-escapes it, so ClickHouse's parser accepts it as text.
        const result = serializeAttributes({
          nested: { text: `deep${LONE_HIGH_SURROGATE}` },
        });
        expect(result.nested!.isWellFormed()).toBe(true);
      });
    });
  });
});

describe("deserializeAttributes", () => {
  describe("when given boolean strings", () => {
    it("converts 'true' to boolean true", () => {
      const result = deserializeAttributes({ flag: "true" });
      expect(result).toEqual({ flag: true });
    });

    it("converts 'false' to boolean false", () => {
      const result = deserializeAttributes({ flag: "false" });
      expect(result).toEqual({ flag: false });
    });
  });

  describe("when given numeric strings", () => {
    it("converts integer strings to numbers", () => {
      const result = deserializeAttributes({ count: "42" });
      expect(result).toEqual({ count: 42 });
    });

    it("converts float strings to numbers", () => {
      const result = deserializeAttributes({ rate: "3.14" });
      expect(result).toEqual({ rate: 3.14 });
    });

    it("converts negative number strings", () => {
      const result = deserializeAttributes({ offset: "-5" });
      expect(result).toEqual({ offset: -5 });
    });
  });

  describe("when given JSON strings", () => {
    it("parses JSON objects", () => {
      const result = deserializeAttributes({ data: '{"nested":true}' });
      expect(result).toEqual({ data: { nested: true } });
    });

    it("parses JSON arrays", () => {
      const result = deserializeAttributes({ items: "[1,2,3]" });
      expect(result).toEqual({ items: [1, 2, 3] });
    });

    it("keeps invalid JSON-looking strings as strings", () => {
      const result = deserializeAttributes({ bad: "{not json" });
      expect(result).toEqual({ bad: "{not json" });
    });
  });

  describe("when given plain strings", () => {
    it("keeps non-special strings unchanged", () => {
      const result = deserializeAttributes({ name: "hello world" });
      expect(result).toEqual({ name: "hello world" });
    });

    it("keeps empty strings unchanged", () => {
      const result = deserializeAttributes({ empty: "" });
      expect(result).toEqual({ empty: "" });
    });
  });

  describe("when given hex/octal/binary string values", () => {
    it("keeps hex strings as strings", () => {
      // "0x1A" should NOT be converted to 26
      expect(deserializeAttributes({ hex: "0x1A" })).toEqual({ hex: "0x1A" });
    });

    it("keeps octal strings as strings", () => {
      expect(deserializeAttributes({ oct: "0o777" })).toEqual({ oct: "0o777" });
    });

    it("keeps binary strings as strings", () => {
      expect(deserializeAttributes({ bin: "0b101" })).toEqual({ bin: "0b101" });
    });
  });

  describe("when given numeric-looking string values (known lossy behavior)", () => {
    it("converts decimal-looking strings to numbers", () => {
      // Known trade-off: zip codes etc. become numbers
      expect(deserializeAttributes({ zip: "90210" })).toEqual({ zip: 90210 });
    });
  });

  describe("when round-tripping with serializeAttributes", () => {
    it("recovers numbers after serialize → deserialize", () => {
      const original = { count: 42, rate: 3.14 };
      const serialized = serializeAttributes(original);
      const deserialized = deserializeAttributes(serialized);
      expect(deserialized).toEqual(original);
    });

    it("recovers booleans after serialize → deserialize", () => {
      const original = { flag: true, off: false };
      const serialized = serializeAttributes(original);
      const deserialized = deserializeAttributes(serialized);
      expect(deserialized).toEqual(original);
    });

    it("recovers objects after serialize → deserialize", () => {
      const original = { data: { nested: true, count: 1 } };
      const serialized = serializeAttributes(original);
      const deserialized = deserializeAttributes(serialized);
      expect(deserialized).toEqual(original);
    });

    it("recovers arrays after serialize → deserialize", () => {
      const original = { items: [1, 2, 3] };
      const serialized = serializeAttributes(original);
      const deserialized = deserializeAttributes(serialized);
      expect(deserialized).toEqual(original);
    });
  });
});

describe("given a requested span-read limit", () => {
  describe("when no limit is given", () => {
    it("defaults to the hard ceiling", () => {
      expect(clampSpanReadLimit(undefined)).toBe(MAX_DERIVATION_SPANS);
    });
  });

  describe("when the requested limit is below the ceiling", () => {
    it("keeps the requested limit", () => {
      expect(clampSpanReadLimit(100)).toBe(100);
    });
  });

  describe("when the requested limit exceeds the ceiling", () => {
    it("clamps to the ceiling so a leaked trace_id cannot raise it", () => {
      expect(clampSpanReadLimit(MAX_DERIVATION_SPANS + 50_000)).toBe(
        MAX_DERIVATION_SPANS,
      );
    });
  });

  describe("when the requested limit is zero or negative", () => {
    it("floors at 1", () => {
      expect(clampSpanReadLimit(0)).toBe(1);
      expect(clampSpanReadLimit(-10)).toBe(1);
    });
  });

  describe("when the requested limit is fractional", () => {
    it("truncates toward zero", () => {
      expect(clampSpanReadLimit(10.9)).toBe(10);
    });
  });

  describe("when the requested limit is not a finite number", () => {
    it("defaults to the ceiling instead of propagating NaN/Infinity", () => {
      expect(clampSpanReadLimit(NaN)).toBe(MAX_DERIVATION_SPANS);
      expect(clampSpanReadLimit(Infinity)).toBe(MAX_DERIVATION_SPANS);
    });
  });

  describe("when a caller supplies its own ceiling", () => {
    it("clamps to that ceiling instead of the derivation default", () => {
      expect(
        clampSpanReadLimit(50_000, { max: MAX_LIGHT_SPAN_READ_ROWS }),
      ).toBe(MAX_LIGHT_SPAN_READ_ROWS);
      expect(clampSpanReadLimit(undefined, { max: 100 })).toBe(100);
    });
  });
});

describe("SpanStorageClickHouseRepository single-trace reads", () => {
  function repoWithSpyClient() {
    const query = vi.fn().mockResolvedValue({ json: async () => [] });
    const repo = new SpanStorageClickHouseRepository((async () => ({
      query,
    })) as unknown as ConstructorParameters<
      typeof SpanStorageClickHouseRepository
    >[0]);
    return { repo, query };
  }

  describe("when reading a trace's full-attribute spans", () => {
    it("caps query memory so one heavy trace cannot pressure the whole server", async () => {
      const { repo, query } = repoWithSpyClient();
      // Pass an occurredAtMs hint so the read goes straight to the span query;
      // the hint-less path first issues a trace_summaries time-resolve query
      // (covered by the integration suite), which is not what this asserts.
      await repo.getSpansByTraceId({
        tenantId: "p-1",
        traceId: "t-1",
        occurredAtMs: Date.now(),
      });

      const settings = query.mock.calls[0]?.[0]?.clickhouse_settings;
      expect(settings?.max_memory_usage).toBe(String(2 * 1024 * 1024 * 1024));
    });

    it("caps query memory on the normalized-spans read", async () => {
      const { repo, query } = repoWithSpyClient();
      await repo.getNormalizedSpansByTraceId({
        tenantId: "p-1",
        traceId: "t-1",
        occurredAtMs: Date.now(),
      });

      const settings = query.mock.calls[0]?.[0]?.clickhouse_settings;
      expect(settings?.max_memory_usage).toBe(String(2 * 1024 * 1024 * 1024));
    });

    it("caps query memory on the single-span read", async () => {
      const { repo, query } = repoWithSpyClient();
      await repo.getSpanByIds({
        tenantId: "p-1",
        traceId: "t-1",
        spanId: "s-1",
        occurredAtMs: Date.now(),
      });

      const settings = query.mock.calls[0]?.[0]?.clickhouse_settings;
      expect(settings?.max_memory_usage).toBe(String(2 * 1024 * 1024 * 1024));
    });
  });
});

describe("SpanStorageClickHouseRepository span-summary pages", () => {
  const summaryRow = (
    spanId: string,
    startTimeMs = 1_700_000_000_000,
  ): SpanSummaryQueryRow => ({
    SpanId: spanId,
    ParentSpanId: null,
    SpanName: spanId,
    DurationMs: 1,
    StatusCode: null,
    SpanType: "llm",
    Model: "",
    ResponseModel: "",
    Cost: "",
    InputTokens: "",
    OutputTokens: "",
    CacheReadTokens: "",
    CacheCreationTokens: "",
    CustomInputRate: "",
    CustomOutputRate: "",
    CustomCacheReadRate: "",
    CustomCacheCreationRate: "",
    LwSpanCost: "",
    StartTimeMs: startTimeMs,
    UpdatedAtMs: startTimeMs,
  });

  function repoWithSpyClient(pages: SpanSummaryQueryRow[][] = [[]]) {
    const query = vi.fn();
    for (const rows of pages) {
      query.mockResolvedValueOnce({ json: async () => rows });
    }
    query.mockResolvedValue({ json: async () => [] });
    const repo = new SpanStorageClickHouseRepository((async () => ({
      query,
    })) as unknown as ConstructorParameters<
      typeof SpanStorageClickHouseRepository
    >[0]);
    return { repo, query };
  }

  describe("when a page fills to the requested limit and more spans exist", () => {
    it("over-fetches one row to derive hasMore and returns only the page", async () => {
      const { repo, query } = repoWithSpyClient([
        [summaryRow("s-1"), summaryRow("s-2"), summaryRow("s-3")],
      ]);

      const page = await repo.findSpanSummariesPage({
        tenantId: "p-1",
        traceId: "t-1",
        limit: 2,
        occurredAtMs: Date.now(),
      });

      expect(query.mock.calls[0]?.[0]?.query_params?.limit).toBe(3);
      expect(page.rows.map((r) => r.spanId)).toEqual(["s-1", "s-2"]);
      expect(page.hasMore).toBe(true);
    });
  });

  describe("when the page comes back short of the limit", () => {
    it("reports hasMore false without any follow-up fetch", async () => {
      const { repo, query } = repoWithSpyClient([
        [summaryRow("s-1"), summaryRow("s-2")],
      ]);

      const page = await repo.findSpanSummariesPage({
        tenantId: "p-1",
        traceId: "t-1",
        limit: 2,
        occurredAtMs: Date.now(),
      });

      expect(page.rows).toHaveLength(2);
      expect(page.hasMore).toBe(false);
      expect(query).toHaveBeenCalledTimes(1);
    });
  });

  describe("when reading a cursor page", () => {
    it("bounds StartTime from below only — an upper bound would truncate long-running traces at the hint window's edge", async () => {
      const { repo, query } = repoWithSpyClient([[summaryRow("s-2")]]);

      await repo.findSpanSummariesPage({
        tenantId: "p-1",
        traceId: "t-1",
        limit: 2,
        cursor: { startTimeMs: 1_700_000_000_000, spanId: "s-1" },
        occurredAtMs: Date.now(),
      });

      const sql = query.mock.calls[0]?.[0]?.query as string;
      expect(sql).toContain(
        "(toUnixTimestamp64Milli(StartTime), SpanId) > ({cursorStartTimeMs:Int64}, {cursorSpanId:String})",
      );
      expect(sql).toContain("StartTime >=");
      expect(sql).not.toContain("StartTime <=");
    });

    it("keeps every cursor bound out of the dedup subquery so a page can't emit a stale span version", async () => {
      // The subquery elects each span's latest version via max(UpdatedAt), so
      // it has to see every version. Bounding it by the cursor's StartTime
      // breaks that for a span re-emitted with a corrected EARLIER start: its
      // latest version sorts below the bound, the inner scan elects an older
      // one instead, and the outer tuple filter emits that stale row — which
      // then wins the waterfall, the client deduping last-write-wins.
      const { repo, query } = repoWithSpyClient([[summaryRow("s-2")]]);

      await repo.findSpanSummariesPage({
        tenantId: "p-1",
        traceId: "t-1",
        limit: 2,
        cursor: { startTimeMs: 1_700_000_000_000, spanId: "s-1" },
        occurredAtMs: Date.now(),
      });

      const sql = query.mock.calls[0]?.[0]?.query as string;
      const dedupSubquery = sql.slice(
        sql.indexOf("(TenantId, TraceId, SpanId, UpdatedAt) IN ("),
      );
      expect(dedupSubquery).toContain("max(UpdatedAt)");
      expect(dedupSubquery).not.toContain("cursorStartTimeMs");
      expect(dedupSubquery).not.toContain("cursorSpanId");
      // The outer scan still restates it — that is what prunes partitions.
      expect(sql).toContain(
        "AND StartTime >= fromUnixTimestamp64Milli({cursorStartTimeMs:Int64})",
      );
    });

    it("treats an empty cursor page as authoritative end-of-trace instead of rescanning unhinted", async () => {
      const { repo, query } = repoWithSpyClient([[]]);

      const page = await repo.findSpanSummariesPage({
        tenantId: "p-1",
        traceId: "t-1",
        limit: 2,
        cursor: { startTimeMs: 1_700_000_000_000, spanId: "s-1" },
        occurredAtMs: Date.now(),
      });

      expect(page).toEqual({ rows: [], hasMore: false });
      expect(query).toHaveBeenCalledTimes(1);
    });
  });

  describe("when reading the first page with an occurredAtMs hint", () => {
    it("prunes partitions with the hint as a lower bound only", async () => {
      const occurredAtMs = 1_700_000_000_000;
      const { repo, query } = repoWithSpyClient([[summaryRow("s-1")]]);

      await repo.findSpanSummariesPage({
        tenantId: "p-1",
        traceId: "t-1",
        limit: 2,
        occurredAtMs,
      });

      const call = query.mock.calls[0]?.[0];
      expect(call?.query as string).toContain(
        "StartTime >= fromUnixTimestamp64Milli({pageFromMs:Int64})",
      );
      expect(call?.query as string).not.toContain("StartTime <=");
      expect(call?.query_params?.pageFromMs).toBe(
        occurredAtMs - 2 * 24 * 60 * 60 * 1000,
      );
    });

    it("retries unbounded when the hinted read is empty (stale or skewed hint)", async () => {
      const { repo, query } = repoWithSpyClient([[], [summaryRow("s-1")]]);

      const page = await repo.findSpanSummariesPage({
        tenantId: "p-1",
        traceId: "t-1",
        limit: 2,
        occurredAtMs: 1_700_000_000_000,
      });

      expect(query).toHaveBeenCalledTimes(2);
      expect(query.mock.calls[1]?.[0]?.query as string).not.toContain(
        "pageFromMs",
      );
      expect(page.rows.map((r) => r.spanId)).toEqual(["s-1"]);
    });
  });
});

describe("SpanStorageClickHouseRepository bounded light readers", () => {
  function repoWithSpyClient() {
    const query = vi.fn().mockResolvedValue({ json: async () => [] });
    const repo = new SpanStorageClickHouseRepository((async () => ({
      query,
    })) as unknown as ConstructorParameters<
      typeof SpanStorageClickHouseRepository
    >[0]);
    return { repo, query };
  }

  const byTrace = {
    tenantId: "p-1",
    traceId: "t-1",
    occurredAtMs: Date.now(),
  };

  describe("when reading the whole-tree span summary anchor", () => {
    it("caps the read at the light-row ceiling", async () => {
      const { repo, query } = repoWithSpyClient();
      await repo.getSpanSummaryByTraceId(byTrace);

      expect(query.mock.calls[0]?.[0]?.query as string).toContain(
        `LIMIT ${MAX_LIGHT_SPAN_READ_ROWS}`,
      );
    });
  });

  describe("when reading per-span langwatch signals", () => {
    it("caps the scan at the light-row ceiling, ordered by the raw StartTime column the subquery actually has", async () => {
      const { repo, query } = repoWithSpyClient();
      await repo.findLangwatchSignalsByTraceId(byTrace);

      const sql = query.mock.calls[0]?.[0]?.query as string;
      expect(sql).toContain(`LIMIT ${MAX_LIGHT_SPAN_READ_ROWS}`);
      // The signals subquery selects only SpanId + mapKeys(SpanAttributes);
      // ordering by the StartTimeMs alias (which it never computes) makes
      // ClickHouse reject the whole query with UNKNOWN_IDENTIFIER.
      expect(sql).toContain("ORDER BY StartTime ASC");
      expect(sql).not.toContain("ORDER BY StartTimeMs");
    });
  });

  describe("when reading the span-summary delta since a high-water mark", () => {
    it("caps the read at the light-row ceiling", async () => {
      const { repo, query } = repoWithSpyClient();
      await repo.findSpanSummariesSince({
        tenantId: "p-1",
        traceId: "t-1",
        sinceUpdatedAtMs: Date.now(),
      });

      expect(query.mock.calls[0]?.[0]?.query as string).toContain(
        `LIMIT ${MAX_LIGHT_SPAN_READ_ROWS}`,
      );
    });

    it("bounds on the row version, never the span start, so in-place updates are visible", async () => {
      // A span updated in place (end time, duration, status, cost) keeps its
      // StartTime. Bounding on StartTime would make the live poll structurally
      // incapable of ever seeing it — the root span, which ends last, would
      // stay frozen at its first projection.
      const { repo, query } = repoWithSpyClient();
      await repo.findSpanSummariesSince({
        tenantId: "p-1",
        traceId: "t-1",
        sinceUpdatedAtMs: 1_700_000_000_000,
      });

      const sql = query.mock.calls[0]?.[0]?.query as string;
      expect(sql).toContain(
        "AND UpdatedAt > fromUnixTimestamp64Milli({sinceUpdatedAtMs:Int64})",
      );
      expect(sql).not.toContain("StartTime > fromUnixTimestamp64Milli");
      expect(query.mock.calls[0]?.[0]?.query_params).toMatchObject({
        sinceUpdatedAtMs: 1_700_000_000_000,
      });
    });

    it("selects the row version so the client can advance its high-water mark", async () => {
      const { repo, query } = repoWithSpyClient();
      await repo.findSpanSummariesSince({
        tenantId: "p-1",
        traceId: "t-1",
        sinceUpdatedAtMs: 0,
      });

      expect(query.mock.calls[0]?.[0]?.query as string).toContain(
        "toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAtMs",
      );
    });
  });

  describe("when reading the full-span delta since a high-water mark", () => {
    it("caps the read at the derivation ceiling", async () => {
      const { repo, query } = repoWithSpyClient();
      await repo.findSpansSince({
        tenantId: "p-1",
        traceId: "t-1",
        sinceStartTimeMs: Date.now(),
      });

      expect(query.mock.calls[0]?.[0]?.query as string).toContain(
        `LIMIT ${MAX_DERIVATION_SPANS}`,
      );
    });
  });
});

describe("mapSpanSummaryRow", () => {
  const baseRow = (
    overrides: Partial<SpanSummaryQueryRow>,
  ): SpanSummaryQueryRow => ({
    SpanId: "s-1",
    ParentSpanId: null,
    SpanName: "llm call",
    DurationMs: 12,
    StatusCode: null,
    SpanType: "llm",
    Model: "",
    ResponseModel: "",
    Cost: "",
    InputTokens: "",
    OutputTokens: "",
    CacheReadTokens: "",
    CacheCreationTokens: "",
    CustomInputRate: "",
    CustomOutputRate: "",
    CustomCacheReadRate: "",
    CustomCacheCreationRate: "",
    LwSpanCost: "",
    StartTimeMs: 1700000000000,
    UpdatedAtMs: 1700000000000,
    ...overrides,
  });

  describe("given an explicit positive cost", () => {
    it("uses the explicit cost over any computed value", () => {
      const result = mapSpanSummaryRow(
        baseRow({
          Cost: "0.5",
          Model: "gpt-5-mini",
          InputTokens: "1000",
          OutputTokens: "1000",
        }),
      );
      expect(result.cost).toBe(0.5);
    });
  });

  describe("given an explicit cost of '0'", () => {
    it("falls through to the computed fallback", () => {
      const result = mapSpanSummaryRow(
        baseRow({
          Cost: "0",
          Model: "gpt-5-mini",
          InputTokens: "1000",
          OutputTokens: "1000",
        }),
      );
      expect(result.cost).not.toBeNull();
      expect(result.cost).toBeGreaterThan(0);
    });

    it("yields null cost when nothing is computable", () => {
      const result = mapSpanSummaryRow(baseRow({ Cost: "0" }));
      expect(result.cost).toBeNull();
    });
  });

  describe("given empty or malformed numeric strings", () => {
    it("maps them to null tokens and null cost", () => {
      const result = mapSpanSummaryRow(
        baseRow({
          Cost: "not-a-number",
          InputTokens: "",
          OutputTokens: "abc",
          CacheReadTokens: "NaN",
          CacheCreationTokens: "",
        }),
      );
      expect(result.inputTokens).toBeNull();
      expect(result.outputTokens).toBeNull();
      expect(result.cacheReadTokens).toBeNull();
      expect(result.cacheCreationTokens).toBeNull();
      expect(result.cost).toBeNull();
    });
  });

  describe("given a tokens-only row with a known registry model", () => {
    it("computes a positive cost from the static registry", () => {
      const result = mapSpanSummaryRow(
        baseRow({
          Model: "gpt-5-mini",
          InputTokens: "1000",
          OutputTokens: "500",
        }),
      );
      expect(result.cost).not.toBeNull();
      expect(result.cost).toBeGreaterThan(0);
    });
  });

  describe("given custom input/output rates", () => {
    it("computes cost from the custom rates", () => {
      const result = mapSpanSummaryRow(
        baseRow({
          Model: "my-custom-model",
          InputTokens: "1000",
          OutputTokens: "1000",
          CustomInputRate: "0.001",
          CustomOutputRate: "0.002",
        }),
      );
      expect(result.cost).toBeCloseTo(1000 * 0.001 + 1000 * 0.002, 10);
    });
  });

  describe("given a custom cache-read rate with cache tokens", () => {
    it("applies the cache-read rate to cache tokens instead of the input rate", () => {
      const result = mapSpanSummaryRow(
        baseRow({
          Model: "my-custom-model",
          InputTokens: "1000",
          OutputTokens: "0",
          CacheReadTokens: "1000",
          CustomInputRate: "0.001",
          CustomOutputRate: "0.002",
          CustomCacheReadRate: "0.0001",
        }),
      );
      expect(result.cost).toBeCloseTo(1000 * 0.001 + 1000 * 0.0001, 10);
    });
  });
});

describe("SpanStorageClickHouseRepository ClickHouse record building", () => {
  function repoWithInsertSpy() {
    const insert = vi.fn().mockResolvedValue(undefined);
    const repo = new SpanStorageClickHouseRepository((async () => ({
      insert,
    })) as unknown as ConstructorParameters<
      typeof SpanStorageClickHouseRepository
    >[0]);
    return { repo, insert };
  }

  function spanWithLoneSurrogates(): SpanInsertData {
    return {
      id: "proj-1",
      tenantId: "proj-1",
      traceId: "t-1",
      spanId: "s-1",
      parentSpanId: null,
      parentTraceId: null,
      parentIsRemote: null,
      sampled: true,
      startTimeUnixMs: 1_700_000_000_000,
      endTimeUnixMs: 1_700_000_000_100,
      durationMs: 100,
      name: `span name ${LONE_HIGH_SURROGATE}`,
      kind: 0,
      resourceAttributes: {
        [`res.key.${LONE_HIGH_SURROGATE}`]: `res.val.${LONE_LOW_SURROGATE}`,
      },
      spanAttributes: {
        [`attr.key.${LONE_HIGH_SURROGATE}`]: `attr.val.${LONE_LOW_SURROGATE}`,
        nested: { text: `deep ${LONE_HIGH_SURROGATE}` },
      },
      statusCode: 2,
      statusMessage: `error: ${LONE_LOW_SURROGATE}`,
      instrumentationScope: {
        name: `scope ${LONE_HIGH_SURROGATE}`,
        version: `v1 ${LONE_LOW_SURROGATE}`,
      },
      events: [
        {
          name: `event ${LONE_HIGH_SURROGATE}`,
          timeUnixMs: 1_700_000_000_050,
          attributes: {
            [`ev.key.${LONE_HIGH_SURROGATE}`]: `ev.val.${LONE_LOW_SURROGATE}`,
          },
        },
      ],
      links: [
        {
          traceId: "lt-1",
          spanId: "ls-1",
          attributes: {
            [`ln.key.${LONE_HIGH_SURROGATE}`]: `ln.val.${LONE_LOW_SURROGATE}`,
          },
        },
      ],
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
      cost: null,
      nonBilledCost: null,
      retentionDays: 0,
    };
  }

  describe("given a span whose name, status, scope, events and attributes carry lone UTF-16 surrogates", () => {
    describe("when the repository builds the record for the JSONEachRow insert", () => {
      it("sanitises every string in the record to well-formed UTF-16", async () => {
        const { repo, insert } = repoWithInsertSpy();

        await repo.insertSpans([spanWithLoneSurrogates()]);

        const record = insert.mock.calls[0]?.[0]?.values?.[0];
        expect(record).toBeDefined();
        for (const s of collectStrings(record)) {
          expect(s.isWellFormed()).toBe(true);
        }
      });

      it("replaces the lone surrogates with U+FFFD instead of dropping the fields", async () => {
        const { repo, insert } = repoWithInsertSpy();

        await repo.insertSpans([spanWithLoneSurrogates()]);

        const record = insert.mock.calls[0]?.[0]?.values?.[0];
        // Assert the marker landed so the test cannot pass vacuously against an
        // unsanitised record — the fix must actually have run on each field.
        expect(record.SpanName).toContain("�");
        expect(record.StatusMessage).toContain("�");
        expect(record.ScopeName).toContain("�");
        expect(record.ScopeVersion).toContain("�");
        expect(record["Events.Name"][0]).toContain("�");
      });

      it("emits a record that survives a JSON encode/decode round-trip well-formed, which a lone surrogate would not", async () => {
        const { repo, insert } = repoWithInsertSpy();

        await repo.insertSpans([spanWithLoneSurrogates()]);

        const record = insert.mock.calls[0]?.[0]?.values?.[0];
        // The client sends the record as JSON (JSONEachRow); ClickHouse decodes
        // it strictly. A lone surrogate would survive JSON.stringify as a
        // `\uD83D`-style escape and reconstruct as an unpaired half on decode —
        // the exact input ClickHouse rejects. A well-formed record cannot.
        const reparsed = JSON.parse(JSON.stringify(record));
        for (const s of collectStrings(reparsed)) {
          expect(s.isWellFormed()).toBe(true);
        }
      });
    });
  });
});
