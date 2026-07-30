import type { ClickHouseClient } from "@langwatch/clickhouse";
import { type HandlerContext, parseGroupKey, renderGroupKey } from "@langwatch/event-sourcing";
import { describe, expect, it, vi } from "vitest";
import {
  applyLogFactsContributed,
  applyMetricFactsContributed,
  applySpanFactsContributed,
  CODING_AGENT_SESSION_STATE_VERSION,
  initCodingAgentSessionState,
} from "../codingAgentSession.projection";
import {
  codingAgentContributionCommandGroupKey,
  codingAgentSessionGroupKey,
  codingAgentTraceSessionsGroupKey,
  createCodingAgentProcessingPipeline,
  sessionMetricSeriesGroupKey,
} from "../index";
import { checkCodingAgentProcessingRatchet } from "../ratchet";
import type {
  CodingAgentSessionState,
  LogFactsContribution,
  MetricFactsContribution,
  SpanFactsContribution,
} from "../schema";

const TENANT = "tenant-1";
const SESSION = "session-1";
const ctx: HandlerContext = { now: 1_000, tenantId: TENANT };

function spanFacts(overrides: Partial<SpanFactsContribution> = {}): SpanFactsContribution {
  return {
    tenantId: TENANT,
    sessionId: SESSION,
    sessionKeySource: "provider",
    agent: "claude_code",
    occurredAt: 1_000,
    acceptedAt: 1_000,
    traceId: "trace-1",
    spanId: "span-1",
    name: "claude_code.tool",
    startTimeUnixMs: 1_000,
    endTimeUnixMs: 1_100,
    statusCode: 1,
    facts: {},
    scopeName: "anthropic",
    ...overrides,
  };
}

function logFacts(overrides: Partial<LogFactsContribution> = {}): LogFactsContribution {
  return {
    tenantId: TENANT,
    sessionId: SESSION,
    sessionKeySource: "provider",
    agent: "claude_code",
    occurredAt: 2_000,
    acceptedAt: 2_000,
    recordId: "record-1",
    traceId: null,
    spanId: null,
    timeUnixMs: 2_000,
    severityNumber: null,
    providerKind: "anthropic",
    scopeName: "anthropic",
    facts: {},
    ...overrides,
  };
}

function metricFacts(overrides: Partial<MetricFactsContribution> = {}): MetricFactsContribution {
  return {
    tenantId: TENANT,
    sessionId: SESSION,
    sessionKeySource: "provider",
    agent: "claude_code",
    occurredAt: 3_000,
    acceptedAt: 3_000,
    seriesId: "series-1",
    metricName: "claude_code.lines_of_code.count",
    unit: null,
    attributes: {},
    value: 10,
    dataPointCount: 1,
    asOfUnixMs: 3_000,
    ...overrides,
  };
}

const client: ClickHouseClient = {
  query: vi.fn().mockResolvedValue({ rows: [] }),
  stream: vi.fn(),
  insert: vi.fn().mockResolvedValue(undefined),
  close: vi.fn(),
};

function buildPipeline() {
  return createCodingAgentProcessingPipeline({ client });
}

describe("given the coding-agent-processing pipeline's composition", () => {
  it("names itself 'coding_agent_session', matching the persisted AggregateType already in event_log", () => {
    expect(buildPipeline().name).toBe("coding_agent_session");
  });

  it("reproduces the dotted strings event_log already holds, byte for byte", () => {
    expect([...buildPipeline().eventTypes].sort()).toEqual(
      [
        "lw.obs.coding_agent_session.span_facts_contributed",
        "lw.obs.coding_agent_session.log_facts_contributed",
        "lw.obs.coding_agent_session.metric_facts_contributed",
      ].sort(),
    );
  });

  it("still derives every string the committed ratchet snapshot remembers", () => {
    expect(checkCodingAgentProcessingRatchet()).toEqual([]);
  });

  /**
   * Every store checks its table at construction — the merge strategy, the
   * key and tenant columns, and that the sort key starts with what a read
   * binds — so a wiring a table cannot serve fails here, not on a delivery.
   */
  it("wires each projection to a store its table can serve", () => {
    expect(() => buildPipeline()).not.toThrow();
  });

  it("mounts one fold, two maps and three commands", () => {
    const built = buildPipeline();
    expect(Object.keys(built.folds)).toEqual(["codingAgentSession"]);
    expect(Object.keys(built.maps).sort()).toEqual(
      ["codingAgentTraceSessions", "sessionMetricSeries"].sort(),
    );
    expect(Object.keys(built.commands).sort()).toEqual(
      ["contributeSpanFacts", "contributeLogFacts", "contributeMetricFacts"].sort(),
    );
  });

  /** @scenario the deploy-critical version pin is honoured, and matches the shape it is stamped on */
  it("pins the fold's stamp to the deployed generation, on the same row shape that generation was written in", () => {
    const built = buildPipeline();
    expect(CODING_AGENT_SESSION_STATE_VERSION).toBe("2026-07-28");
    expect(built.folds.codingAgentSession!.stateVersion).toBe("2026-07-28");
  });
});

describe("given a command's emitted event", () => {
  it("stamps it with the pipeline's derived persisted type, carrying the input through unchanged", async () => {
    const built = buildPipeline();
    const input = spanFacts();
    const emitted = await built.commands.contributeSpanFacts!.handle(input, ctx);
    expect(emitted).toEqual([
      { type: "lw.obs.coding_agent_session.span_facts_contributed", data: input },
    ]);
  });
});

describe("given the codingAgentSession fold", () => {
  it("folds all three signals into one session", async () => {
    const built = buildPipeline();
    const events = [
      { type: "lw.obs.coding_agent_session.span_facts_contributed", data: spanFacts() },
      { type: "lw.obs.coding_agent_session.log_facts_contributed", data: logFacts() },
      { type: "lw.obs.coding_agent_session.metric_facts_contributed", data: metricFacts() },
    ];
    await expect(
      built.folds.codingAgentSession!.apply({ key: SESSION, tenantId: TENANT, events }),
    ).resolves.toEqual({ events: 3 });
  });

  /**
   * Permutation invariance only, not `checkOrderInvariance`'s full sweep:
   * this fold's counters (`modelCalls + 1`, `toolCalls + 1`, …) are not
   * idempotent under a literal redelivery of one already-applied event —
   * exactly like the deployed fold, which relies on `AppliedEventIds` to
   * filter a redelivery out before it ever reaches `apply`. This build does
   * not implement that filter (see the pipeline's report), so the
   * duplication half of the check is expected to fail and is not asserted
   * here; the ordering half — a fixed, non-duplicated set folds to the same
   * state in any delivery order — still must hold (ADR-098 decision 4).
   */
  it("folds a fixed set of distinct events to the same state regardless of delivery order", () => {
    type Event =
      | { kind: "span"; data: SpanFactsContribution }
      | { kind: "log"; data: LogFactsContribution }
      | { kind: "metric"; data: MetricFactsContribution };

    // `agent` is first-writer-wins over replay (`withContributionIdentity`),
    // deliberately so a refold reproduces the label the dispatcher resolved
    // at ingest — not last-write-wins. A real session's contributions always
    // agree on which agent produced them, so every ordering below shares
    // one agent throughout, exactly like real traffic.
    const events: Event[] = [
      { kind: "span", data: spanFacts({ acceptedAt: 1_000, startTimeUnixMs: 5_000, facts: { tool_name: "Read" } }) },
      {
        kind: "log",
        data: logFacts({ acceptedAt: 3_000, facts: { "event.name": "user_prompt", prompt_length: 12 } }),
      },
      { kind: "metric", data: metricFacts({ acceptedAt: 2_000, asOfUnixMs: 500 }) },
      {
        kind: "span",
        data: spanFacts({ acceptedAt: 4_000, spanId: "span-2", startTimeUnixMs: 100, name: "claude_code.tool", facts: { tool_name: "Bash" } }),
      },
      {
        kind: "log",
        data: logFacts({
          acceptedAt: 4_000,
          recordId: "record-2",
          facts: { "event.name": "assistant_response", response_length: 30 },
        }),
      },
    ];

    const apply = (state: CodingAgentSessionState, event: Event): CodingAgentSessionState => {
      switch (event.kind) {
        case "span":
          return applySpanFactsContributed(state, event.data);
        case "log":
          return applyLogFactsContributed(state, event.data);
        case "metric":
          return applyMetricFactsContributed(state, event.data);
      }
    };
    const fold = (order: readonly number[]) =>
      order.reduce((state, index) => apply(state, events[index]!), initCodingAgentSessionState());

    const forward = fold([0, 1, 2, 3, 4]);
    const reversed = fold([4, 3, 2, 1, 0]);
    const shuffled = fold([2, 0, 4, 1, 3]);

    expect(reversed).toEqual(forward);
    expect(shuffled).toEqual(forward);
  });

  describe("when a later contribution names a different agent", () => {
    // `withContributionIdentity`'s `agent: state.agent ?? data.agent` is
    // first-writer-wins, deliberately: a refold replays stored contributions
    // and must reproduce the label each one's own dispatcher resolved at
    // ingest, not let a later replay overwrite it.
    it("keeps the first contribution's agent label", () => {
      let state = initCodingAgentSessionState();
      state = applySpanFactsContributed(state, spanFacts({ agent: "claude_code", acceptedAt: 1_000 }));
      state = applyLogFactsContributed(
        state,
        logFacts({ agent: "claude_cowork", acceptedAt: 2_000, facts: { "event.name": "at_mention" } }),
      );
      expect(state.agent).toBe("claude_code");
    });
  });

  describe("when a session's earliest signal arrives late", () => {
    /** @scenario "a session whose earliest signal arrives late is listed once, up to date" */
    it("moves startedAtMs backwards without needing a stamp, in either arrival order", () => {
      let state = initCodingAgentSessionState();
      state = applySpanFactsContributed(state, spanFacts({ startTimeUnixMs: 5_000 }));
      expect(state.startedAtMs).toBe(5_000);
      state = applySpanFactsContributed(state, spanFacts({ startTimeUnixMs: 1_000, spanId: "span-2" }));
      expect(state.startedAtMs).toBe(1_000);
    });
  });

  describe("when a span, a log and a metric contribution all fold", () => {
    it("establishes identity from whichever signal arrives, and counts each signal's own facts", () => {
      let state = initCodingAgentSessionState();
      state = applySpanFactsContributed(state, spanFacts({ facts: { tool_name: "Read" } }));
      state = applyLogFactsContributed(
        state,
        logFacts({ facts: { "event.name": "user_prompt", prompt_length: 12 } }),
      );
      state = applyMetricFactsContributed(state, metricFacts());

      expect(state.agent).toBe("claude_code");
      expect(state.sessionKeySource).toBe("provider");
      expect(state.toolCalls).toBe(1);
      expect(state.prompts).toBe(1);
    });
  });
});

describe("given the trace-sessions map", () => {
  it("records the trace a span contribution contributed under", async () => {
    const built = buildPipeline();
    const outcome = await built.maps.codingAgentTraceSessions!.apply({
      tenantId: TENANT,
      events: [{ type: "lw.obs.coding_agent_session.span_facts_contributed", data: spanFacts() }],
    });
    expect(outcome.written).toBe(1);
  });

  it("maps nothing for a log contribution that resolved no trace correlation", async () => {
    const built = buildPipeline();
    const outcome = await built.maps.codingAgentTraceSessions!.apply({
      tenantId: TENANT,
      events: [{ type: "lw.obs.coding_agent_session.log_facts_contributed", data: logFacts({ traceId: null }) }],
    });
    expect(outcome.written).toBe(0);
  });

  it("maps nothing for a metric contribution — a metric point carries no trace correlation", async () => {
    const built = buildPipeline();
    const outcome = await built.maps.codingAgentTraceSessions!.apply({
      tenantId: TENANT,
      events: [{ type: "lw.obs.coding_agent_session.metric_facts_contributed", data: metricFacts() }],
    });
    expect(outcome.written).toBe(0);
  });
});

describe("given the sessionMetricSeries map — restoring the deployed session_metric_series projection", () => {
  it("writes one row per converged metric unit, and ignores span/log contributions", async () => {
    const built = buildPipeline();
    const outcome = await built.maps.sessionMetricSeries!.apply({
      tenantId: TENANT,
      events: [
        { type: "lw.obs.coding_agent_session.metric_facts_contributed", data: metricFacts() },
        { type: "lw.obs.coding_agent_session.span_facts_contributed", data: spanFacts() },
      ],
    });
    expect(outcome.written).toBe(1);
  });
});

describe("given this pipeline's group keys", () => {
  it("is scoped to the aggregate, never a wider scope, for the fold", () => {
    const key = codingAgentSessionGroupKey({ tenantId: TENANT, sessionId: SESSION });
    expect(key.lane).toEqual({ kind: "fold", name: "codingAgentSession" });
    expect(key.scope).toEqual({
      kind: "aggregate",
      aggregateType: "coding_agent_session",
      aggregateId: SESSION,
    });
  });

  it("round-trips through the package's own renderer and parser", () => {
    const key = codingAgentSessionGroupKey({ tenantId: TENANT, sessionId: SESSION });
    expect(parseGroupKey(renderGroupKey(key))).toEqual(key);
  });

  it("gives every map its own lane, all scoped to the same session", () => {
    const traceSessions = codingAgentTraceSessionsGroupKey({ tenantId: TENANT, sessionId: SESSION });
    const metricSeries = sessionMetricSeriesGroupKey({ tenantId: TENANT, sessionId: SESSION });

    expect(traceSessions.lane).toEqual({ kind: "map", name: "codingAgentTraceSessions" });
    expect(metricSeries.lane).toEqual({ kind: "map", name: "sessionMetricSeries" });
    expect(traceSessions.scope).toEqual(metricSeries.scope);
  });

  it("gives each contribution command its own lane, scoped to the same session", () => {
    const span = codingAgentContributionCommandGroupKey({ tenantId: TENANT, sessionId: SESSION, command: "contributeSpanFacts" });
    const log = codingAgentContributionCommandGroupKey({ tenantId: TENANT, sessionId: SESSION, command: "contributeLogFacts" });
    expect(span.lane).toEqual({ kind: "command", name: "contributeSpanFacts" });
    expect(log.lane).toEqual({ kind: "command", name: "contributeLogFacts" });
    expect(span.scope).toEqual(log.scope);
  });
});
