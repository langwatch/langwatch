/**
 * The coding-agent session fold STORE reads its own last committed state back
 * from ClickHouse instead of returning null (ADR-066). These tests execute the
 * real serialize → record → deserialize path, so the round-trip is exact and a
 * contribution applied after a cache miss lands on the full prior session.
 *
 * @see specs/coding-agent/session-aggregate.feature
 *   ("a session resumes from its own stored state after its cache is lost")
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it } from "vitest";
import { createTenantId } from "~/server/event-sourcing";
import { CodingAgentSessionClickHouseRepository } from "~/server/app-layer/coding-agent/repositories/coding-agent-session.clickhouse.repository";
import type {
  CodingAgentSessionRepository,
  CodingAgentSessionRow,
} from "~/server/app-layer/coding-agent/repositories/coding-agent-session.repository";
import {
  METRIC_FACTS_CONTRIBUTED_EVENT_TYPE,
  SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
} from "../../schemas/constants";
import type {
  MetricFactsContributedEvent,
  SpanFactsContributedEvent,
} from "../../schemas/events";
import {
  CodingAgentSessionFoldProjection,
  type CodingAgentSessionState,
  projectCodingAgentSessionToRow,
} from "../codingAgentSession.foldProjection";
import { CodingAgentSessionStore } from "../codingAgentSession.store";
import type { ProjectionStoreContext } from "../../../../projections/projectionStoreContext";

const SESSION_ID = "8f2c9a1e-4711-4e0f-9d2e-session";
const TRACE_A = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const TRACE_B = "b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d7";

function makeProjection(): CodingAgentSessionFoldProjection {
  return new CodingAgentSessionFoldProjection({
    store: { store: async () => {}, get: async () => null },
  });
}

/** `initState` is protected; the cast names the REAL state type on purpose. */
function initStateOf(
  projection: CodingAgentSessionFoldProjection,
): CodingAgentSessionState {
  return (
    projection as unknown as { initState: () => CodingAgentSessionState }
  ).initState();
}

function spanEvent({
  name,
  spanId,
  traceId = TRACE_A,
  facts = {},
  startMs = 1_000,
  endMs = 2_000,
  statusCode = 0,
}: {
  name: string;
  spanId: string;
  traceId?: string;
  facts?: Record<string, string | number | boolean>;
  startMs?: number;
  endMs?: number;
  statusCode?: number;
}): SpanFactsContributedEvent {
  return {
    tenantId: createTenantId("tenant-1"),
    type: SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
    data: {
      tenantId: "tenant-1",
      sessionId: SESSION_ID,
      sessionKeySource: "provider",
      agent: "claude_code",
      occurredAt: startMs,
      traceId,
      spanId,
      name,
      startTimeUnixMs: startMs,
      endTimeUnixMs: endMs,
      statusCode,
      facts,
      scopeName: "com.anthropic.claude_code.tracing",
    },
  } as unknown as SpanFactsContributedEvent;
}

function metricEvent({
  seriesId,
  metricName,
  attributes = {},
  value,
  asOfMs = 1_500,
}: {
  seriesId: string;
  metricName: string;
  attributes?: Record<string, string | number | boolean>;
  value: number;
  asOfMs?: number;
}): MetricFactsContributedEvent {
  return {
    tenantId: createTenantId("tenant-1"),
    type: METRIC_FACTS_CONTRIBUTED_EVENT_TYPE,
    data: {
      tenantId: "tenant-1",
      sessionId: SESSION_ID,
      sessionKeySource: "provider",
      agent: "claude_code",
      occurredAt: asOfMs,
      seriesId,
      metricName,
      unit: null,
      attributes,
      value,
      dataPointCount: 1,
      asOfUnixMs: asOfMs,
    },
  } as unknown as MetricFactsContributedEvent;
}

/**
 * A realistic session that exercises the three bookkeeping fields the analytics
 * columns drop: `subAgentIds` (two distinct sub-agents), `metricSeries` (two
 * delta units + one cumulative unit) and `previousCallContextTokens` (the last
 * model call's context size).
 */
function buildSession(): CodingAgentSessionState {
  const projection = makeProjection();
  let state = initStateOf(projection);

  // A model call from a sub-agent, carrying cache tokens → sets subAgentIds and
  // previousCallContextTokens.
  state = projection.handleCodingAgentSessionSpanFactsContributed(
    spanEvent({
      name: "claude_code.llm_request",
      spanId: "llm-1",
      facts: {
        input_tokens: 100,
        cache_read_tokens: 5_000,
        cache_creation_tokens: 2_000,
        agent_id: "sub-1",
        request_id: "req_1",
        stop_reason: "end_turn",
      },
    }),
    state,
  );
  // A tool span from a SECOND sub-agent → subAgentIds grows to two.
  state = projection.handleCodingAgentSessionSpanFactsContributed(
    spanEvent({
      name: "claude_code.tool",
      spanId: "tool-1",
      traceId: TRACE_B,
      facts: { tool_name: "Read", agent_id: "sub-2" },
    }),
    state,
  );
  // Two DELTA line-removed units and one CUMULATIVE line-added unit.
  state = projection.handleCodingAgentSessionMetricFactsContributed(
    metricEvent({
      seriesId: "removed-1",
      metricName: "claude_code.lines_of_code.count",
      attributes: { type: "removed" },
      value: 10,
    }),
    state,
  );
  state = projection.handleCodingAgentSessionMetricFactsContributed(
    metricEvent({
      seriesId: "removed-2",
      metricName: "claude_code.lines_of_code.count",
      attributes: { type: "removed" },
      value: 5,
    }),
    state,
  );
  state = projection.handleCodingAgentSessionMetricFactsContributed(
    metricEvent({
      seriesId: "added-cumulative",
      metricName: "claude_code.lines_of_code.count",
      attributes: { type: "added" },
      value: 120,
    }),
    state,
  );

  return state;
}

/**
 * A fake ClickHouse client that captures the inserted record and serves it back
 * from `query()`. Paired with the REAL repository, this drives the actual
 * `toRecord` → `fromRecord` mapping without a container — the `State` column is
 * a plain String, so it round-trips losslessly (the integration test proves the
 * whole-row contract against real ClickHouse).
 */
function makeFakeClickHouse(): { client: ClickHouseClient } {
  let stored: Record<string, unknown> | null = null;
  const client = {
    async insert({ values }: { values: Record<string, unknown>[] }) {
      stored = values[0] ?? null;
    },
    async query() {
      return { async json() {
        return stored ? [stored] : [];
      } };
    },
  };
  return { client: client as unknown as ClickHouseClient };
}

function makeStoreWithFakeClickHouse(): CodingAgentSessionStore {
  const { client } = makeFakeClickHouse();
  const repo = new CodingAgentSessionClickHouseRepository(async () => client);
  return new CodingAgentSessionStore(repo);
}

const context: ProjectionStoreContext = {
  aggregateId: SESSION_ID,
  tenantId: createTenantId("tenant-1"),
};

/** A minimal repo that serves one row, for the null / empty / corrupt cases. */
class SingleRowRepo implements CodingAgentSessionRepository {
  constructor(private readonly row: CodingAgentSessionRow | null) {}
  async upsert(): Promise<void> {}
  async findBySessionId(): Promise<CodingAgentSessionRow | null> {
    return this.row;
  }
  async findManyRecent(): Promise<CodingAgentSessionRow[]> {
    return [];
  }
}

function rowWithState(state: string): CodingAgentSessionRow {
  const row = projectCodingAgentSessionToRow({
    state: initStateOf(makeProjection()),
    tenantId: "tenant-1",
    sessionId: SESSION_ID,
    version: "2026-07-21",
  });
  return { ...row, state };
}

describe("CodingAgentSessionStore", () => {
  describe("when the cache misses and the store reads its own state back", () => {
    it("round-trips the full fold state, bookkeeping fields included", async () => {
      const original = buildSession();
      const store = makeStoreWithFakeClickHouse();

      await store.store(original, context);
      const readBack = await store.get(SESSION_ID, context);

      // The whole state survives — not just the analytics columns.
      expect(readBack).toEqual(original);
      // The three fields the analytics columns deliberately drop are present.
      expect(readBack!.subAgentIds).toEqual(["sub-1", "sub-2"]);
      expect(readBack!.previousCallContextTokens).toBe(7_000);
      expect(Object.keys(readBack!.metricSeries)).toEqual([
        "removed-1",
        "removed-2",
        "added-cumulative",
      ]);
    });

    it("resumes the metric map so a later contribution does not double-count", async () => {
      const store = makeStoreWithFakeClickHouse();
      await store.store(buildSession(), context);

      const resumed = await store.get(SESSION_ID, context);
      expect(resumed).not.toBeNull();
      // The read-back carried the converged delta units forward.
      expect(resumed!.linesRemoved).toBe(15);

      const projection = makeProjection();
      // Re-delivering an already-counted DELTA unit must REPLACE it, not add —
      // only possible because its metricSeries entry survived the read-back.
      const afterRedelivery =
        projection.handleCodingAgentSessionMetricFactsContributed(
          metricEvent({
            seriesId: "removed-1",
            metricName: "claude_code.lines_of_code.count",
            attributes: { type: "removed" },
            value: 10,
          }),
          resumed!,
        );
      expect(afterRedelivery.linesRemoved).toBe(15);

      // A genuinely new delta unit adds on top of the resumed 15.
      const afterNew =
        projection.handleCodingAgentSessionMetricFactsContributed(
          metricEvent({
            seriesId: "removed-3",
            metricName: "claude_code.lines_of_code.count",
            attributes: { type: "removed" },
            value: 7,
          }),
          afterRedelivery,
        );
      expect(afterNew.linesRemoved).toBe(22);
    });
  });

  describe("when there is no usable stored state", () => {
    it("returns null for a genuinely new aggregate so the framework inits", async () => {
      const store = new CodingAgentSessionStore(new SingleRowRepo(null));
      expect(await store.get(SESSION_ID, context)).toBeNull();
    });

    it("returns null when the stored blob is empty", async () => {
      const store = new CodingAgentSessionStore(
        new SingleRowRepo(rowWithState("")),
      );
      expect(await store.get(SESSION_ID, context)).toBeNull();
    });

    it("degrades to init on a corrupt blob rather than throwing", async () => {
      const store = new CodingAgentSessionStore(
        new SingleRowRepo(rowWithState("{not valid json")),
      );
      await expect(store.get(SESSION_ID, context)).resolves.toBeNull();
    });
  });
});
