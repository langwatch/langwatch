/**
 * `POST /api/v1/traces/search`: digest/json formats, evaluations, pagination,
 * the projection DSL and the date axis, all over real services - only
 * `TraceApi` itself is a double.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  bindRestMiddleware,
  createRestRuntime,
  projectRestFacts,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import {
  explorerHiddenOrigins,
  FilterParseError,
  type Evaluation,
  type TraceApi,
  type TracesForProjectResult,
  type TraceWithGuardrail,
} from "@langwatch/trace-contract";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it, vi } from "vitest";

import { ClickHouseTraceQueryRepository } from "#repositories/clickhouse/clickhouse.trace-query.repository";
import {
  andFilterConditions,
  findHiddenOriginConditions,
} from "#rules/trace-filter-hidden-origins.rules";
import type * as projectionCompileRules from "#rules/trace-projection-compile.rules";
import { compileProjection } from "#rules/trace-projection-compile.rules";

import { tracesRestCredential, tracesRest } from "../traces.rest.ts";

vi.mock("#rules/trace-projection-compile.rules", async (importOriginal) => {
  const actual = await importOriginal<typeof projectionCompileRules>();
  return { ...actual, compileProjection: vi.fn(actual.compileProjection) };
});

const traceQueryTranslator = ClickHouseTraceQueryRepository.create();

/**
 * The real `TraceApi.compileExplorerTraceFilter` (`trace.app.ts`), rebuilt
 * here over the same production translator and rules so this door's filter
 * behavior is exercised for real — only `TraceApi` itself is a double.
 */
function compileExplorerTraceFilter(input: {
  query: string;
  tenantId: string;
  timeRange: { from: number; to: number };
  originNamed?: boolean;
  dateField?: "occurred" | "updated";
}): { sql: string; params: Record<string, unknown> } {
  const compiled = traceQueryTranslator.translateFilter({
    queryText: input.query,
    tenantId: input.tenantId,
    timeRange: input.timeRange,
  });

  if (input.dateField === "updated" && compiled?.sql.includes("stored_spans")) {
    throw new FilterParseError(
      "A span, event or free-text clause matches spans by when they started, and dateField " +
        '"updated" selects traces by when they were last modified — the two together would ' +
        "drop traces silently. Filter on trace-level fields instead, or pull on the occurred axis.",
    );
  }

  const hiddenOrigins = input.originNamed ? [] : explorerHiddenOrigins(input.query);

  return andFilterConditions([
    ...(compiled ? [compiled] : []),
    ...findHiddenOriginConditions({ hiddenOrigins }),
  ]);
}

const PROTECTIONS = { canSeeCapturedInput: true, canSeeCapturedOutput: true };

/** A `TraceWithGuardrail` row with the fields the search route reads. */
function traceRow(input: {
  traceId: string;
  startedAt: number;
  inputValue?: string;
  outputValue?: string;
}): TraceWithGuardrail {
  return {
    trace_id: input.traceId,
    project_id: "project-123",
    input: { value: input.inputValue ?? `input-${input.traceId}` },
    output: { value: input.outputValue ?? `output-${input.traceId}` },
    timestamps: {
      started_at: input.startedAt,
      inserted_at: input.startedAt,
      updated_at: input.startedAt,
    },
    metadata: {},
    spans: [],
    lastGuardrail: undefined,
  };
}

const TRACE_1 = traceRow({
  traceId: "trace-1",
  startedAt: 1000,
  inputValue: "What is AI?",
  outputValue: "AI is artificial intelligence.",
});
const TRACE_2 = traceRow({
  traceId: "trace-2",
  startedAt: 3000,
  inputValue: "Hello",
  outputValue: "Hi there",
});

const EVAL_1: Evaluation = {
  evaluation_id: "eval-1",
  evaluator_id: "evaluator-1",
  name: "sentiment",
  status: "processed",
  score: 0.95,
  label: "positive",
  timestamps: { started_at: 1000, finished_at: 2000 },
};

function tracePage(rows: TraceWithGuardrail[], extra: Partial<TracesForProjectResult> = {}) {
  return {
    groups: rows.length > 0 ? [rows] : [],
    totalHits: rows.length,
    traceChecks: Object.fromEntries(rows.map((r) => [r.trace_id, []])),
    ...extra,
  };
}

const DEFAULT_PAGE: TracesForProjectResult = tracePage([TRACE_1, TRACE_2], {
  traceChecks: { "trace-1": [EVAL_1], "trace-2": [] },
});

const boundaryErrorHandler: RestErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const serialized = error.serialize();
    return c.json(
      { error: serialized.code, ...serialized.meta, reasons: serialized.reasons },
      (serialized.httpStatus ?? 500) as ContentfulStatusCode,
    );
  }
  return c.json({ error: "internal_server_error" }, 500);
};

function mount(overrides: Readonly<{ listTraces?: TraceApi["listTraces"] }> = {}) {
  const listTraces: TraceApi["listTraces"] =
    overrides.listTraces ?? vi.fn(async () => DEFAULT_PAGE);
  const resolveApiKeyProtections: TraceApi["resolveApiKeyProtections"] = vi.fn(
    async () => PROTECTIONS,
  );
  const platformUrl: TraceApi["platformUrl"] = ({ projectSlug, path }) =>
    `https://app.langwatch.test/${projectSlug}${path}`;

  const stub = createApiFixture<TraceApi>({
    listTraces,
    resolveApiKeyProtections,
    platformUrl,
    compileExplorerTraceFilter,
  });

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "user" as const, id: "user-1" },
        scope: { tier: "project" as const, id: "project-123" },
      }),
    },
  });

  const hono = runtime.mount(tracesRest.router(), {
    app: () => stub,
    credential: "project",
    onError: boundaryErrorHandler,
    facts: [
      bindRestMiddleware(projectRestFacts, () => ({
        projectSlug: "project-one",
        viewerUserId: null,
        actorId: "user-1",
      })),
      bindRestMiddleware(tracesRestCredential, () => ({ apiKeyId: null, userId: "user-1" })),
    ],
  });

  const send = (body: Record<string, unknown>) =>
    hono.request("http://api.test/api/v1/traces/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  return { send, listTraces };
}

/** The `/search` response envelope, typed loosely at the boundary a real client reads it at. */
type SearchBody = Readonly<{
  traces: Record<string, unknown>[];
  pagination: Record<string, unknown>;
  schema?: Record<string, unknown>;
  error?: string;
  reasons?: { code: string; meta: Record<string, unknown> }[];
}>;

async function bodyOf(res: Response): Promise<SearchBody> {
  return (await res.json()) as SearchBody;
}

describe("POST /search", () => {
  describe("when format is digest", () => {
    it("passes includeSpans as false by default", async () => {
      const { send, listTraces } = mount();
      await send({ startDate: 1000, endDate: 5000, format: "digest" });
      expect(listTraces).toHaveBeenCalledWith(
        expect.objectContaining({ options: expect.objectContaining({ includeSpans: false }) }),
      );
    });

    it("returns compact summary digests instead of full span content", async () => {
      const { send } = mount();
      const res = await send({ startDate: 1000, endDate: 5000, format: "digest" });
      const body = await bodyOf(res);
      expect(body.traces).toHaveLength(2);
      expect(body.traces[0]?.formatted_trace).toBe(
        "Input: What is AI?\nOutput: AI is artificial intelligence.",
      );
    });

    /** @scenario "The REST trace endpoints link with the timestamp" */
    it("includes trace metadata in each digest entry", async () => {
      const { send } = mount();
      const res = await send({ startDate: 1000, endDate: 5000, format: "digest" });
      const body = await bodyOf(res);
      const first = body.traces[0];
      expect(first).toHaveProperty("trace_id", "trace-1");
      expect(first).toHaveProperty("input");
      expect(first).toHaveProperty("output");
      expect(first).toHaveProperty("timestamps");
      expect(first).toHaveProperty("metadata");
      expect(first?.platformUrl).toContain("/traces/trace-1?t=1000");
    });
  });

  describe("when includeSpans is true", () => {
    it("passes includeSpans true to the trace service", async () => {
      const { send, listTraces } = mount();
      await send({ startDate: 1000, endDate: 5000, format: "json", includeSpans: true });
      expect(listTraces).toHaveBeenCalledWith(
        expect.objectContaining({ options: expect.objectContaining({ includeSpans: true }) }),
      );
    });
  });

  describe("when format is json", () => {
    it("returns raw trace data", async () => {
      const { send } = mount();
      const res = await send({ startDate: 1000, endDate: 5000, format: "json" });
      const body = await bodyOf(res);
      expect(body.traces).toHaveLength(2);
      expect(body.traces[0]).toHaveProperty("trace_id", "trace-1");
      expect(body.traces[0]).not.toHaveProperty("formatted_trace");
    });
  });

  describe("when format defaults via llmMode", () => {
    it("uses digest format when llmMode is true", async () => {
      const { send } = mount();
      const res = await send({ startDate: 1000, endDate: 5000, llmMode: true });
      const body = await bodyOf(res);
      expect(body.traces[0]).toHaveProperty("formatted_trace");
    });
  });

  describe("when traceChecks contains evaluations", () => {
    it("includes evaluations in json format response traces", async () => {
      const { send } = mount();
      const res = await send({ startDate: 1000, endDate: 5000, format: "json" });
      const body = await bodyOf(res);
      expect(body.traces[0]?.evaluations).toEqual([
        expect.objectContaining({ evaluation_id: "eval-1", score: 0.95 }),
      ]);
      expect(body.traces[1]?.evaluations).toEqual([]);
    });

    it("includes evaluations in digest format response traces", async () => {
      const { send } = mount();
      const res = await send({ startDate: 1000, endDate: 5000, format: "digest" });
      const body = await bodyOf(res);
      expect(body.traces[0]?.evaluations).toEqual([
        expect.objectContaining({ evaluation_id: "eval-1", score: 0.95 }),
      ]);
      expect(body.traces[1]?.evaluations).toEqual([]);
    });

    it("includes evaluations when llmMode is true", async () => {
      const { send } = mount();
      const res = await send({ startDate: 1000, endDate: 5000, llmMode: true });
      const body = await bodyOf(res);
      expect(body.traces[0]?.evaluations).toEqual([
        expect.objectContaining({ evaluation_id: "eval-1", score: 0.95 }),
      ]);
      expect(body.traces[1]?.evaluations).toEqual([]);
    });
  });

  describe("when result set is large", () => {
    it("serializes many traces with correct comma separation", async () => {
      const manyTraces = Array.from({ length: 50 }, (_, i) =>
        traceRow({ traceId: `trace-${i}`, startedAt: i * 100 }),
      );
      const { send } = mount({
        listTraces: vi.fn(async () => tracePage(manyTraces, { scrollId: "next-page-token" })),
      });

      const res = await send({ startDate: 0, endDate: 10000 });
      const body = await bodyOf(res);
      expect(body.traces).toHaveLength(50);
      expect(body.traces[0]?.trace_id).toBe("trace-0");
      expect(body.traces[49]?.trace_id).toBe("trace-49");
      expect(body.pagination.scrollId).toBe("next-page-token");
    });

    describe("when the service reports an updated-axis snapshot boundary", () => {
      it("puts it on the wire, since a client cannot resume safely without it", async () => {
        const { send } = mount({
          listTraces: vi.fn(async () =>
            tracePage([TRACE_1, TRACE_2], {
              scrollId: "next-page-token",
              updatedThrough: 1_700_000_123_456,
            }),
          ),
        });

        const res = await send({ startDate: 0, endDate: 10000 });
        const body = await bodyOf(res);
        expect(body.pagination.updatedThrough).toBe(1_700_000_123_456);
      });
    });

    describe("when the service reports no snapshot boundary", () => {
      it("omits the field rather than sending a null a client might resume from", async () => {
        const { send } = mount({
          listTraces: vi.fn(async () =>
            tracePage([TRACE_1, TRACE_2], { scrollId: "next-page-token" }),
          ),
        });

        const res = await send({ startDate: 0, endDate: 10000 });
        const body = await bodyOf(res);
        expect(body.pagination).not.toHaveProperty("updatedThrough");
      });
    });

    it("returns valid JSON for empty result set", async () => {
      const { send } = mount({ listTraces: vi.fn(async () => tracePage([])) });
      const res = await send({ startDate: 1000, endDate: 5000 });
      const body = await bodyOf(res);
      expect(body.traces).toHaveLength(0);
      expect(body.pagination.totalHits).toBe(0);
    });
  });

  describe("when a trace fails to serialize", () => {
    it("drops it and surfaces a skipped count in pagination", async () => {
      const badTrace = traceRow({ traceId: "bad-trace", startedAt: 1 });
      const metadata: Record<string, unknown> = badTrace.metadata as Record<string, unknown>;
      metadata.self = badTrace; // a circular ref makes JSON.stringify throw in the serialize loop

      const { send } = mount({
        listTraces: vi.fn(async () => tracePage([badTrace, TRACE_1])),
      });

      const res = await send({ startDate: 1000, endDate: 5000, format: "json" });
      const body = await bodyOf(res);
      expect(body.traces).toHaveLength(1);
      expect(body.traces[0]?.trace_id).toBe("trace-1");
      expect(body.pagination.skipped).toBe(1);
    });

    it("omits skipped from pagination when nothing is dropped", async () => {
      const { send } = mount();
      const res = await send({ startDate: 1000, endDate: 5000, format: "json" });
      const body = await bodyOf(res);
      expect(body.pagination).not.toHaveProperty("skipped");
    });
  });

  describe("when no projection select is provided", () => {
    it("does not compile a projection", async () => {
      const spy = vi.mocked(compileProjection).mockClear();
      const { send } = mount();
      await send({ startDate: 1000, endDate: 5000, format: "json" });
      expect(spy).not.toHaveBeenCalled();
    });

    it("omits the schema field from the response", async () => {
      const { send } = mount();
      const res = await send({ startDate: 1000, endDate: 5000, format: "json" });
      const body = await bodyOf(res);
      expect(body).not.toHaveProperty("schema");
    });
  });

  describe("when a projection select is provided", () => {
    it("compiles the projection with from, select, and protections", async () => {
      const spy = vi.mocked(compileProjection).mockClear();
      const { send } = mount();
      await send({ startDate: 1000, endDate: 5000, from: "traces", select: ["trace_id"] });
      expect(spy).toHaveBeenCalledWith({
        from: "traces",
        select: ["trace_id"],
        protections: PROTECTIONS,
      });
    });

    it("forwards the compiled plan to the trace service", async () => {
      const spy = vi.mocked(compileProjection).mockClear();
      const { send, listTraces } = mount();
      await send({ startDate: 1000, endDate: 5000, from: "traces", select: ["trace_id"] });
      expect(listTraces).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({ projection: spy.mock.results[0]?.value.plan }),
        }),
      );
    });

    it("projects each trace through the compiled projector", async () => {
      const { send } = mount();
      const res = await send({
        startDate: 1000,
        endDate: 5000,
        from: "traces",
        select: ["trace_id"],
      });
      const body = await bodyOf(res);
      expect(body.traces).toEqual([{ trace_id: "trace-1" }, { trace_id: "trace-2" }]);
    });

    it("includes the resolved schema in the response envelope", async () => {
      const { send } = mount();
      const res = await send({
        startDate: 1000,
        endDate: 5000,
        from: "traces",
        select: ["trace_id"],
      });
      const body = await bodyOf(res);
      expect(body.schema).toEqual({
        from: "traces",
        columns: [{ path: "trace_id", type: "string", collection: false }],
      });
    });

    it("defaults from to traces when only select is provided", async () => {
      const spy = vi.mocked(compileProjection).mockClear();
      const { send } = mount();
      await send({ startDate: 1000, endDate: 5000, select: ["trace_id"] });
      expect(spy).toHaveBeenCalledWith({
        from: "traces",
        select: ["trace_id"],
        protections: PROTECTIONS,
      });
      const res = await send({ startDate: 1000, endDate: 5000, select: ["trace_id"] });
      const body = await bodyOf(res);
      expect(body).toHaveProperty("schema");
    });
  });

  describe("when the projection select is invalid", () => {
    it("responds 422", async () => {
      const { send } = mount();
      const res = await send({ startDate: 1000, endDate: 5000, select: ["nonexistent_field"] });
      expect(res.status).toBe(422);
    });

    // The path used to be concatenated into the sentence. It is structure now:
    // an unknown select path is a field violation like any other, so a caller
    // reads it where it reads every other one - reasons[].meta. See
    // specs/features/domain-error-contract.feature.
    it("names the invalid path in a reason rather than in the message", async () => {
      const { send } = mount();
      const res = await send({ startDate: 1000, endDate: 5000, select: ["nonexistent_field"] });
      const body = await bodyOf(res);
      expect(body.error).toBe("validation_error");
      expect(body.reasons).toHaveLength(1);
      expect(body.reasons?.[0]?.code).toBe("schema_failure");
      expect(body.reasons?.[0]?.meta.field).toBe("select");
      expect(body.reasons?.[0]?.meta.received).toBe("nonexistent_field");
    });

    it("does not query the trace service", async () => {
      const { send, listTraces } = mount();
      await send({ startDate: 1000, endDate: 5000, select: ["nonexistent_field"] });
      expect(listTraces).not.toHaveBeenCalled();
    });
  });

  describe("when the projection request fails schema validation", () => {
    it("rejects an unsupported from entity with 422", async () => {
      const spy = vi.mocked(compileProjection).mockClear();
      const { send } = mount();
      const res = await send({
        startDate: 1000,
        endDate: 5000,
        from: "sessions",
        select: ["trace_id"],
      });
      expect(res.status).toBe(422);
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects an empty select array with 422", async () => {
      const spy = vi.mocked(compileProjection).mockClear();
      const { send } = mount();
      const res = await send({ startDate: 1000, endDate: 5000, select: [] });
      expect(res.status).toBe(422);
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects a select with more than 200 paths with 422", async () => {
      const spy = vi.mocked(compileProjection).mockClear();
      const { send } = mount();
      const res = await send({
        startDate: 1000,
        endDate: 5000,
        select: Array.from({ length: 201 }, (_, i) => `metadata.key_${i}`),
      });
      expect(res.status).toBe(422);
      expect(spy).not.toHaveBeenCalled();
    });

    it("rejects a select path longer than 256 characters with 422", async () => {
      const spy = vi.mocked(compileProjection).mockClear();
      const { send } = mount();
      const res = await send({
        startDate: 1000,
        endDate: 5000,
        select: [`metadata.${"x".repeat(300)}`],
      });
      expect(res.status).toBe(422);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("when a date axis is specified", () => {
    it("forwards dateField 'updated' to the trace service", async () => {
      const { send, listTraces } = mount();
      await send({ startDate: 1000, endDate: 5000, dateField: "updated" });
      expect(listTraces).toHaveBeenCalledWith(
        expect.objectContaining({ options: expect.objectContaining({ dateField: "updated" }) }),
      );
    });

    it("defaults dateField to occurred when not specified", async () => {
      const { send, listTraces } = mount();
      await send({ startDate: 1000, endDate: 5000 });
      expect(listTraces).toHaveBeenCalledWith(
        expect.objectContaining({ options: expect.objectContaining({ dateField: "occurred" }) }),
      );
    });

    it("rejects an unsupported date axis with 422", async () => {
      const { send } = mount();
      const res = await send({ startDate: 1000, endDate: 5000, dateField: "created" });
      expect(res.status).toBe(422);
    });
  });
});

/**
 * `filter` compiles over the same `TraceApi.compileExplorerTraceFilter` path
 * `traces.discover` uses. Fold: error shapes are this tree's own codes
 * (`filter_parse_error`, `filter_field_unknown`), not upstream's `validation_error`.
 */
describe("POST /search with a trace filter", () => {
  const filterWhereOf = (listTraces: TraceApi["listTraces"]) =>
    vi.mocked(listTraces).mock.calls[0]?.[0]?.options?.filterWhere;

  describe("when the filter is well formed", () => {
    it("passes a compiled condition down, not the string", async () => {
      const { send, listTraces } = mount();
      await send({ startDate: 1000, endDate: 5000, filter: "status:error" });
      const filterWhere = filterWhereOf(listTraces);
      expect(filterWhere?.sql).toContain("ContainsErrorStatus");
      expect(filterWhere?.params.tenantId).toBe("project-123");
    });

    it("bounds the translation to the window the search asked for", async () => {
      const { send, listTraces } = mount();
      await send({ startDate: 1000, endDate: 5000, filter: "status:error" });
      const filterWhere = filterWhereOf(listTraces);
      expect(filterWhere?.params.timeFrom).toBe(1000);
      expect(filterWhere?.params.timeTo).toBe(5000);
    });

    it("does not forward the raw string as a search field", async () => {
      const { send, listTraces } = mount();
      await send({ startDate: 1000, endDate: 5000, filter: "status:error" });
      expect(vi.mocked(listTraces).mock.calls[0]?.[0]?.query).not.toHaveProperty("filter");
    });
  });

  describe("when no filter is sent", () => {
    it("sends no condition of the filter's own", async () => {
      const { send, listTraces } = mount();
      await send({ startDate: 1000, endDate: 5000 });
      expect(Object.keys(filterWhereOf(listTraces)?.params ?? {})).toEqual(["hiddenOrigins"]);
    });
  });

  describe("when the filter is whitespace", () => {
    it("is the same request as no filter", async () => {
      const { send, listTraces } = mount();
      await send({ startDate: 1000, endDate: 5000, filter: "   " });
      expect(Object.keys(filterWhereOf(listTraces)?.params ?? {})).toEqual(["hiddenOrigins"]);
    });
  });

  describe("given the origins the Trace Explorer leaves out", () => {
    describe("when the search names no origin", () => {
      /** @scenario "A trace search that names no origin leaves out Langy's own traces" */
      it("excludes the Langy origin, after the filter's own terms", async () => {
        const { send, listTraces } = mount();
        await send({ startDate: 1000, endDate: 5000, filter: "status:error" });
        const filterWhere = filterWhereOf(listTraces);
        expect(filterWhere?.params.hiddenOrigins).toEqual(["langy"]);
        expect(filterWhere?.sql).toContain("ContainsErrorStatus");
        expect(filterWhere?.sql).toContain("NOT IN ({hiddenOrigins:Array(String)})");
      });
    });

    describe("when the filter names an origin", () => {
      /** @scenario "A trace search whose filter names an origin is left as asked" */
      it("excludes no origin", async () => {
        const { send, listTraces } = mount();
        await send({ startDate: 1000, endDate: 5000, filter: "origin:langy" });
        const filterWhere = filterWhereOf(listTraces);
        expect(filterWhere?.params.hiddenOrigins).toBeUndefined();
        expect(filterWhere?.sql).not.toContain("NOT IN ({hiddenOrigins");
      });
    });

    describe("when the origin filter names an origin", () => {
      /**
       * @scenario "A trace search whose origin flag names an origin is left as asked"
       * Fold: `compileExplorerTraceFilter` never returns `undefined` (unlike
       * upstream) — with nothing left to filter on, it answers the no-op
       * condition rather than omitting the field.
       */
      it("excludes no origin", async () => {
        const { send, listTraces } = mount();
        await send({
          startDate: 1000,
          endDate: 5000,
          filters: { "traces.origin": ["evaluation"] },
        });
        expect(filterWhereOf(listTraces)).toEqual({ sql: "1 = 1", params: {} });
      });
    });
  });

  describe("when the filter cannot be parsed", () => {
    it("answers 422 naming the filter field", async () => {
      const { send, listTraces } = mount();
      const res = await send({ startDate: 1000, endDate: 5000, filter: "status:" });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("filter_parse_error");
      expect(listTraces).not.toHaveBeenCalled();
    });
  });

  describe("when a span clause rides the updated axis", () => {
    it("answers 422 rather than a result set missing rows", async () => {
      const { send, listTraces } = mount();
      const res = await send({
        startDate: 1000,
        endDate: 5000,
        dateField: "updated",
        filter: "span.attribute.gen_ai.request.model:gpt-5-mini",
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("filter_parse_error");
      expect(listTraces).not.toHaveBeenCalled();
    });

    it("allows a trace-level clause on the same axis", async () => {
      const { send, listTraces } = mount();
      const res = await send({
        startDate: 1000,
        endDate: 5000,
        dateField: "updated",
        filter: "status:error",
      });
      expect(res.status).toBe(200);
      expect(filterWhereOf(listTraces)?.sql).toContain("ContainsErrorStatus");
    });

    it("allows the same span clause on the occurred axis", async () => {
      const { send, listTraces } = mount();
      const res = await send({
        startDate: 1000,
        endDate: 5000,
        filter: "span.attribute.gen_ai.request.model:gpt-5-mini",
      });
      expect(res.status).toBe(200);
      expect(filterWhereOf(listTraces)?.sql).toContain("stored_spans");
    });
  });

  describe("when the filter names a field the language does not have", () => {
    it("answers 422 and names the fields that exist", async () => {
      const { send, listTraces } = mount();
      const res = await send({ startDate: 1000, endDate: 5000, filter: "statuz:error" });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { error: string; field?: string; knownFields?: string[] };
      expect(body.error).toBe("filter_field_unknown");
      expect(body.field).toBe("statuz");
      expect(body.knownFields).toContain("status");
      expect(listTraces).not.toHaveBeenCalled();
    });
  });
});
