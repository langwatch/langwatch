import { describe, expect, it } from "vitest";
import type { Event } from "../../../../domain/types";
import type { AppendStore } from "../../../../projections/mapProjection.types";
import { LOG_FACTS_CONTRIBUTED_EVENT_TYPE } from "../../schemas/constants";
import type { LogFactsContributedEvent } from "../../schemas/events";
import {
  type CodingAgentSessionEventRecord,
  CodingAgentSessionEventsMapProjection,
  EVENT_KIND_BY_RAW_NAME,
  mapsToCodingAgentSessionEvent,
} from "../codingAgentSessionEvents.mapProjection";

const SESSION_ID = "28a0697b-9057-47c4-a927-b53a9e80f139";

function logFactsEvent(
  facts: Record<string, string | number | boolean>,
  over: { traceId?: string | null; timeMs?: number } = {},
): LogFactsContributedEvent {
  const timeMs = over.timeMs ?? 1_700_000_000_000;
  return {
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
  } as unknown as LogFactsContributedEvent;
}

function makeProjection(): CodingAgentSessionEventsMapProjection {
  return new CodingAgentSessionEventsMapProjection({
    store: {
      append: async () => undefined,
      bulkAppend: async () => undefined,
    } as unknown as AppendStore<CodingAgentSessionEventRecord>,
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
        makeProjection().mapCodingAgentSessionLogFactsContributed(
          logFactsEvent({ cost_usd: 1 }),
        ),
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

  describe("its enqueue-time gate", () => {
    /**
     * The wire vocabulary as it actually arrives, taken from a measured
     * dogfooding corpus (34 sessions, 5641 coding-agent log records): every
     * name the projection maps, in both the bare and namespaced spellings, plus
     * every name it does not.
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
    const contributionsInBothSpellings = (
      names: readonly string[],
    ): LogFactsContributedEvent[] =>
      names.flatMap((name) =>
        [name, `claude_code.${name}`].map((spelling) =>
          logFactsEvent({ "event.name": spelling }),
        ),
      );

    it("declares the gate on the projection so the router can read it", () => {
      expect(makeProjection().options?.enqueue?.filter).toBe(
        mapsToCodingAgentSessionEvent,
      );
    });

    /** @scenario "The events fact table declines a contribution it would map to nothing" */
    it("admits every wire name the projection maps, in both spellings", () => {
      const projection = makeProjection();

      for (const event of contributionsInBothSpellings(admittedNames)) {
        expect(mapsToCodingAgentSessionEvent(event as Event)).toBe(true);
        expect(
          projection.mapCodingAgentSessionLogFactsContributed(event),
        ).not.toBeNull();
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
      ]).filter((event) => !mapsToCodingAgentSessionEvent(event as Event));

      // Without this the loop below passes by having nothing to check, which
      // is the one way this invariant can go quiet without anyone noticing.
      expect(rejected.length).toBeGreaterThan(0);

      for (const event of rejected) {
        expect(
          projection.mapCodingAgentSessionLogFactsContributed(event),
        ).toBeNull();
      }
    });

    it("declines the records that dominate a real session", () => {
      for (const name of DECLINED_WIRE_NAMES) {
        expect(
          mapsToCodingAgentSessionEvent(
            logFactsEvent({ "event.name": name }) as Event,
          ),
        ).toBe(false);
      }
    });

    /**
     * The gate runs on the dispatch hot path, where a throw is a dispatch
     * failure rather than a retry. A payload it cannot read at all must
     * therefore answer, not raise — and it answers the same "no row" `map()`
     * would.
     */
    it("answers for a payload with no readable facts instead of throwing", () => {
      for (const data of [undefined, null, {}, { facts: null }, "nonsense"]) {
        expect(
          mapsToCodingAgentSessionEvent({
            type: LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
            data,
          } as unknown as Event),
        ).toBe(false);
      }
    });
  });
});
