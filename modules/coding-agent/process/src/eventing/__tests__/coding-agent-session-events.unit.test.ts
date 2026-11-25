import {
  AI_UNITS_SESSION_FACT,
  LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
  type LogFactsContributedEvent,
  SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
  type SpanFactsContributedEvent,
} from "@langwatch/coding-agent-contract";
import { type AppendStore, createTenantId, type Event, EventSchema } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { TestModelProviderService } from "../../__tests__/fixtures/coding-agent-processing.fixture.ts";
import { spanModelCallRecordId } from "../../rules/coding-agent-model-call-facts.rules.ts";
import {
  type CodingAgentSessionEventRecord,
  CodingAgentSessionEventsMapProjection,
  EVENT_KIND_BY_RAW_NAME,
} from "../coding-agent-session-events.projection.ts";

const SESSION_ID = "28a0697b-9057-47c4-a927-b53a9e80f139";

function logFactsEvent(
  facts: Record<string, string | number | boolean>,
  over: { traceId?: string | null; timeMs?: number } = {},
): LogFactsContributedEvent {
  const timeMs = over.timeMs ?? 1_700_000_000_000;
  return {
    id: "evt-1",
    aggregateId: "aggregate-1",
    aggregateType: "coding_agent_session",
    tenantId: createTenantId("tenant-1"),
    createdAt: timeMs,
    occurredAt: timeMs,
    version: "2025-01-01",
    type: LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
    data: {
      tenantId: "tenant-1",
      sessionId: SESSION_ID,
      sessionKeySource: "provider",
      agent: "claude_code",
      occurredAt: timeMs,
      recordId: `rec-${timeMs}`,
      traceId: over.traceId === undefined ? "trace-1" : over.traceId,
      spanId: null,
      timeUnixMs: timeMs,
      severityNumber: 9,
      providerKind: "claude_code",
      scopeName: "com.anthropic.claude_code.events",
      facts,
    },
  };
}

function spanFactsEvent({
  agent,
  name,
  facts,
  context = {},
}: {
  agent: string;
  name: string;
  facts: Record<string, string | number | boolean>;
  context?: Partial<
    Record<"repositoryHost" | "repositoryOwner" | "repositoryName" | "branch", string>
  >;
}): SpanFactsContributedEvent {
  const timeMs = 1_700_000_000_000;
  return {
    id: "evt-span-1",
    aggregateId: "aggregate-1",
    aggregateType: "coding_agent_session",
    tenantId: createTenantId("tenant-1"),
    createdAt: timeMs,
    occurredAt: timeMs,
    version: "2025-01-01",
    type: SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
    data: {
      tenantId: "tenant-1",
      sessionId: SESSION_ID,
      sessionKeySource: "provider",
      agent,
      occurredAt: timeMs,
      traceId: "trace-1",
      spanId: "span-1",
      name,
      startTimeUnixMs: timeMs,
      endTimeUnixMs: timeMs + 2_400,
      statusCode: 0,
      facts,
      scopeName: null,
      ...context,
    },
  };
}

/** Prices every call at a fixed figure, so a row's cost says it was priced, not reported. */
const PRICE_PER_CALL_USD = 0.0025;

function makeProjection(): CodingAgentSessionEventsMapProjection {
  return CodingAgentSessionEventsMapProjection.create({
    store: {
      append: async () => undefined,
      bulkAppend: async () => undefined,
    } satisfies AppendStore<CodingAgentSessionEventRecord>,
    modelProviders: new TestModelProviderService(() => PRICE_PER_CALL_USD),
  });
}

describe("CodingAgentSessionEventsMapProjection", () => {
  describe("when an api_request contribution arrives", () => {
    /** @scenario a model API call becomes one row with its economics */
    it("maps it to a model_call row carrying its economics", () => {
      const row = makeProjection().mapCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          "event.name": "api_request",
          "prompt.id": "prompt-1",
          "event.sequence": 12,
          query_source: "repl_main_thread",
          model: "claude-haiku-4-5-20251001",
          input_tokens: 4,
          output_tokens: 120,
          cache_read_tokens: 13000,
          cache_creation_tokens: 250,
          cost_usd: 0.0421,
          duration_ms: 1800,
          speed: "standard",
          request_id: "req_abc",
        }),
      );

      expect(row?.eventKind).toBe("model_call");
      expect(row?.sessionId).toBe(SESSION_ID);
      expect(row?.promptId).toBe("prompt-1");
      expect(row?.eventSequence).toBe(12);
      expect(row?.model).toBe("claude-haiku-4-5-20251001");
      expect(row?.inputTokens).toBe(4);
      expect(row?.outputTokens).toBe(120);
      expect(row?.cacheReadTokens).toBe(13000);
      expect(row?.cacheCreationTokens).toBe(250);
      expect(row?.costUsd).toBe(0.0421);
      expect(row?.durationMs).toBe(1800);
      expect(row?.speed).toBe("standard");
      expect(row?.requestId).toBe("req_abc");
    });

    it("parses numeric facts that arrive as strings", () => {
      const row = makeProjection().mapCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          "event.name": "api_request",
          input_tokens: "4",
          cost_usd: "0.0421",
          duration_ms: "1800",
        }),
      );

      expect(row?.inputTokens).toBe(4);
      expect(row?.costUsd).toBe(0.0421);
      expect(row?.durationMs).toBe(1800);
    });
  });

  describe("when the contribution carries a stamped working context", () => {
    it("copies the stamp onto the row", () => {
      const event = logFactsEvent({ "event.name": "api_request" });
      event.data.repositoryHost = "github.com";
      event.data.repositoryOwner = "acme";
      event.data.repositoryName = "widgets";
      event.data.branch = "feat/split";

      const row = makeProjection().mapCodingAgentSessionLogFactsContributed(event);

      expect(row?.repositoryHost).toBe("github.com");
      expect(row?.repositoryOwner).toBe("acme");
      expect(row?.repositoryName).toBe("widgets");
      expect(row?.branch).toBe("feat/split");
    });

    it("stores an unstamped contribution with empty context columns", () => {
      const row = makeProjection().mapCodingAgentSessionLogFactsContributed(
        logFactsEvent({ "event.name": "api_request" }),
      );

      expect(row?.repositoryHost).toBe("");
      expect(row?.repositoryOwner).toBe("");
      expect(row?.repositoryName).toBe("");
      expect(row?.branch).toBe("");
    });
  });

  describe("when a compaction contribution arrives", () => {
    /** @scenario a compaction becomes one row with its before and after tokens */
    it("maps it to a compaction row with pre and post tokens and the trigger", () => {
      const row = makeProjection().mapCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          "event.name": "compaction",
          pre_tokens: 4301,
          post_tokens: 1419,
          trigger: "manual",
          duration_ms: 15124,
          success: true,
          precompute_reuse: "miss_not_ready",
        }),
      );

      expect(row?.eventKind).toBe("compaction");
      expect(row?.preTokens).toBe(4301);
      expect(row?.postTokens).toBe(1419);
      expect(row?.compactionTrigger).toBe("manual");
      expect(row?.precomputeReuse).toBe("miss_not_ready");
      expect(row?.success).toBe("true");
    });
  });

  describe("when a rate limit contribution arrives", () => {
    /** @scenario rate limit events become rows */
    it("maps rate_limit_event and rate_limit_info to rate_limit rows", () => {
      const projection = makeProjection();

      const event = projection.mapCodingAgentSessionLogFactsContributed(
        logFactsEvent({ "event.name": "rate_limit_event" }),
      );
      const info = projection.mapCodingAgentSessionLogFactsContributed(
        logFactsEvent({ "event.name": "rate_limit_info" }, { timeMs: 2 }),
      );

      expect(event?.eventKind).toBe("rate_limit");
      expect(event?.rateLimitCarrier).toBe("event");
      expect(info?.eventKind).toBe("rate_limit");
      expect(info?.rateLimitCarrier).toBe("info");
    });
  });

  describe("when a sub-agent's api_request arrives", () => {
    /** @scenario a sub-agent's model call is attributable per call */
    it("derives the agent type from the agent query source", () => {
      const row = makeProjection().mapCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          "event.name": "api_request",
          query_source: "agent:builtin:general-purpose",
        }),
      );

      expect(row?.querySource).toBe("agent:builtin:general-purpose");
      expect(row?.agentType).toBe("general-purpose");
    });

    it("prefers an explicit agent_type fact over the query source", () => {
      const row = makeProjection().mapCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          "event.name": "subagent_completed",
          agent_type: "general-purpose",
          total_tokens: 13075,
          duration_ms: 1230,
        }),
      );

      expect(row?.eventKind).toBe("subagent_completed");
      expect(row?.agentType).toBe("general-purpose");
      expect(row?.totalTokens).toBe(13075);
    });
  });

  describe("when the event name arrives namespaced", () => {
    /** @scenario namespaced event names map the same as bare ones */
    it("maps claude_code.api_request like api_request", () => {
      const row = makeProjection().mapCodingAgentSessionLogFactsContributed(
        logFactsEvent({ "event.name": "claude_code.api_request" }),
      );

      expect(row?.eventKind).toBe("model_call");
    });
  });

  describe("when the event is outside the row vocabulary", () => {
    /** @scenario events outside the row vocabulary contribute no row */
    it("maps hook and body events to null", () => {
      const projection = makeProjection();

      for (const name of [
        "hook_execution_complete",
        "api_request_body",
        "api_response_body",
        "mcp_server_connection",
      ]) {
        expect(
          projection.mapCodingAgentSessionLogFactsContributed(
            logFactsEvent({ "event.name": name }),
          ),
        ).toBeNull();
      }
    });

    /** @scenario A session context event contributes no session-events row */
    it("maps the LangWatch session context event to null", () => {
      const projection = makeProjection();

      // The companion event describes the session, not something that happened
      // IN it. It folds onto the session row and writes no fact-table row, in
      // either spelling.
      for (const name of ["langwatch.session_context", "session_context"]) {
        expect(
          projection.mapCodingAgentSessionLogFactsContributed(
            logFactsEvent({
              "event.name": name,
              "vcs.repository.owner": "acme",
            }),
          ),
        ).toBeNull();
      }
    });

    /** @scenario contributions without a mappable event name degrade to no rows */
    it("maps a contribution without an event name to null", () => {
      expect(
        makeProjection().mapCodingAgentSessionLogFactsContributed(logFactsEvent({ cost_usd: 1 })),
      ).toBeNull();
    });
  });

  describe("when the contribution resolved no trace", () => {
    it("keeps the row with an empty trace id", () => {
      const row = makeProjection().mapCodingAgentSessionLogFactsContributed(
        logFactsEvent({ "event.name": "api_request" }, { traceId: null }),
      );

      expect(row?.traceId).toBe("");
      expect(row?.eventKind).toBe("model_call");
    });
  });

  describe("given a Copilot model-call span stamped with its working context", () => {
    const event = spanFactsEvent({
      agent: "copilot",
      name: "chat gpt-6-luna",
      facts: {
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": "gpt-6-luna",
        "gen_ai.usage.input_tokens": 13,
        "gen_ai.usage.output_tokens": 50,
        "gen_ai.usage.cache_read.input_tokens": 17_039,
        "gen_ai.usage.cache_creation.input_tokens": 0,
        [AI_UNITS_SESSION_FACT]: 0.038424,
      },
      context: {
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "widgets",
        branch: "feat/copilot",
      },
    });

    /** @scenario "A Copilot model call writes one per-call row carrying its context, tokens and AI units" */
    it("writes one model_call row carrying its context, tokens, computed cost and AI units", () => {
      expect(CodingAgentSessionEventsMapProjection.accepts(event as Event)).toBe(true);
      expect(makeProjection().mapCodingAgentSessionSpanFactsContributed(event)).toMatchObject({
        eventKind: "model_call",
        agent: "copilot",
        sessionId: SESSION_ID,
        recordId: spanModelCallRecordId({ traceId: "trace-1", spanId: "span-1" }),
        traceId: "trace-1",
        spanId: "span-1",
        model: "gpt-6-luna",
        inputTokens: 13,
        outputTokens: 50,
        cacheReadTokens: 17_039,
        cacheCreationTokens: 0,
        costUsd: PRICE_PER_CALL_USD,
        durationMs: 2_400,
        aiUnits: 0.038424,
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "widgets",
        branch: "feat/copilot",
      });
    });

    /** @scenario "A Copilot model call writes one per-call row carrying its context, tokens and AI units" */
    it("keys the row by 64 hex characters, the width the table's record id holds", () => {
      const row = makeProjection().mapCodingAgentSessionSpanFactsContributed(event);
      expect(row?.recordId).toMatch(/^[0-9a-f]{64}$/);
    });

    /** @scenario "A Copilot model call writes one per-call row carrying its context, tokens and AI units" */
    it("writes nothing for the session root or a tool run of the same session", () => {
      const projection = makeProjection();
      for (const name of ["invoke_agent", "execute_tool rg"]) {
        const other = spanFactsEvent({ agent: "copilot", name, facts: {} });
        expect(CodingAgentSessionEventsMapProjection.accepts(other as Event)).toBe(false);
        expect(projection.mapCodingAgentSessionSpanFactsContributed(other)).toBeNull();
      }
    });
  });

  describe("given a Claude Code session that sends both its logs and its spans", () => {
    const facts = {
      model: "claude-sonnet-4-5",
      input_tokens: 4,
      output_tokens: 120,
      cache_read_tokens: 13_000,
      cache_creation_tokens: 250,
    };

    /** @scenario "A model call that sends both a log event and a span is written once" */
    it("writes its model call from the log event alone, never again from the span", () => {
      const projection = makeProjection();
      const log = logFactsEvent({
        "event.name": "claude_code.api_request",
        ...facts,
        cost_usd: 0.04,
      });
      const span = spanFactsEvent({ agent: "claude_code", name: "claude_code.llm_request", facts });

      const rows = [
        projection.mapCodingAgentSessionLogFactsContributed(log),
        projection.mapCodingAgentSessionSpanFactsContributed(span),
      ].filter((row) => row !== null);

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ eventKind: "model_call", costUsd: 0.04, aiUnits: 0 });
      expect(CodingAgentSessionEventsMapProjection.accepts(span as Event)).toBe(false);
    });

    /** @scenario "A model call that sends both a log event and a span is written once" */
    it("writes no row for a codex turn span either, so codex rows stay as they were", () => {
      const turn = spanFactsEvent({
        agent: "codex",
        name: "session_task.turn",
        facts: { "gen_ai.usage.input_tokens": 40 },
      });
      expect(CodingAgentSessionEventsMapProjection.accepts(turn as Event)).toBe(false);
      expect(makeProjection().mapCodingAgentSessionSpanFactsContributed(turn)).toBeNull();
    });
  });

  describe("given its enqueue-time gate", () => {
    /**
     * The wire vocabulary as it actually arrives, from a measured dogfooding
     * corpus (34 sessions, 5641 log records): every name the projection maps,
     * bare and namespaced, plus every name it declines.
     */
    const DECLINED_WIRE_NAMES = [
      "hook_execution_start",
      "hook_execution_complete",
      "hook_registered",
      "api_request_body",
      "api_response_body",
      "assistant_response",
      "mcp_server_connection",
      "plugin_loaded",
      "at_mention",
      "feedback_survey",
      "langwatch.session_context",
      "gen_ai.client.inference.operation.details",
      "gemini_cli.model_routing",
      "gemini_cli.startup_stats",
      "event otel/src/events/session_telemetry.rs:236",
      "",
    ];

    const admittedNames = Object.keys(EVENT_KIND_BY_RAW_NAME);

    /**
     * One contribution per name per spelling the wire uses: bare, and
     * namespaced by the agent that emitted it. Both spellings reach the gate
     * in a real session, so both have to be answered the same way.
     */
    const contributionsInBothSpellings = (names: readonly string[]): LogFactsContributedEvent[] =>
      names.flatMap((name) =>
        [name, `claude_code.${name}`].map((spelling) => logFactsEvent({ "event.name": spelling })),
      );

    it("declares the gate on the projection so the router can read it", () => {
      expect(makeProjection().options?.enqueue?.filter).toBe(
        CodingAgentSessionEventsMapProjection.accepts,
      );
    });

    /** @scenario "The events fact table declines a contribution it would map to nothing" */
    it("admits every wire name the projection maps, in both spellings", () => {
      const projection = makeProjection();

      for (const event of contributionsInBothSpellings(admittedNames)) {
        expect(CodingAgentSessionEventsMapProjection.accepts(event as Event)).toBe(true);
        expect(projection.mapCodingAgentSessionLogFactsContributed(event)).not.toBeNull();
      }
    });

    /**
     * The invariant that makes the gate safe to add at all. A gate admitting a
     * superset of what `map()` maps costs a job that writes nothing — the
     * behavior before it existed. A gate rejecting something `map()` would have
     * mapped is a silent hole in the fact table, because map fan-out is never
     * replayed on the live path. So: rejected implies unmapped, always.
     *
     * @scenario "The events fact table declines a contribution it would map to nothing"
     */
    it("never rejects a contribution the projection would have mapped", () => {
      const projection = makeProjection();
      const rejected = contributionsInBothSpellings([
        ...admittedNames,
        ...DECLINED_WIRE_NAMES,
      ]).filter((event) => !CodingAgentSessionEventsMapProjection.accepts(event as Event));

      // Without this the loop below passes by having nothing to check, which
      // is the one way this invariant can go quiet without anyone noticing.
      expect(rejected.length).toBeGreaterThan(0);

      for (const event of rejected) {
        expect(projection.mapCodingAgentSessionLogFactsContributed(event)).toBeNull();
      }
    });

    it("declines the records that dominate a real session", () => {
      for (const name of DECLINED_WIRE_NAMES) {
        expect(
          CodingAgentSessionEventsMapProjection.accepts(
            logFactsEvent({ "event.name": name }) as Event,
          ),
        ).toBe(false);
      }
    });

    /**
     * The gate runs on the dispatch hot path, where a throw is a dispatch
     * failure, not a retry — so an unreadable payload must answer, not raise,
     * the same "no row" `map()` would.
     */
    it("answers for a payload with no readable facts instead of throwing", () => {
      for (const data of [undefined, null, {}, { facts: null }, "nonsense"]) {
        expect(
          CodingAgentSessionEventsMapProjection.accepts(
            EventSchema.parse({
              id: "evt_1",
              aggregateId: "session_1",
              aggregateType: "coding_agent_session",
              tenantId: "project_1",
              createdAt: 1_800_000_000_000,
              occurredAt: 1_800_000_000_000,
              type: LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
              version: "2026-01-01",
              data,
            }),
          ),
        ).toBe(false);
      }
    });
  });
});
