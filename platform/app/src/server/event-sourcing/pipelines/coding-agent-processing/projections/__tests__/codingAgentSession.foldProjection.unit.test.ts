/**
 * The coding-agent session fold, driven with the contribution events the
 * pipeline actually delivers (ADR-056).
 *
 * @see specs/coding-agent/session-aggregate.feature
 */

import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";
import {
  LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
  METRIC_FACTS_CONTRIBUTED_EVENT_TYPE,
  SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
} from "../../schemas/constants";
import type {
  LogFactsContributedEvent,
  MetricFactsContributedEvent,
  SpanFactsContributedEvent,
} from "../../schemas/events";
import {
  isCodingAgentSessionSpan,
  MAX_SET,
  meanTtftMs,
} from "../../services/coding-agent-session.derivation";
import {
  CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
  CodingAgentSessionFoldProjection,
  type CodingAgentSessionState,
  codingAgentSessionStateFromRow,
  projectCodingAgentSessionToRow,
} from "../codingAgentSession.foldProjection";

const SESSION_ID = "8f2c9a1e-4711-4e0f-9d2e-session";
const TRACE_A = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const TRACE_B = "b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d7";

function makeProjection() {
  return new CodingAgentSessionFoldProjection({
    store: { store: async () => {}, get: async () => null },
  });
}

/**
 * `initState` is protected. Reaching it needs a cast, but the cast has to name
 * the REAL state type — an earlier `() => never` here collapsed every downstream
 * assertion to `never` and hid its own type errors.
 */
function initStateOf(
  projection: CodingAgentSessionFoldProjection,
): CodingAgentSessionState {
  return (
    projection as unknown as { initState: () => CodingAgentSessionState }
  ).initState();
}

function spanFactsEvent({
  name,
  spanId,
  traceId = TRACE_A,
  facts = {},
  startMs = 1_000,
  endMs = 2_000,
  statusCode = 0,
  agent = "claude_code",
}: {
  name: string;
  spanId: string;
  traceId?: string;
  facts?: Record<string, string | number | boolean>;
  startMs?: number;
  endMs?: number;
  statusCode?: number;
  agent?: string;
}): SpanFactsContributedEvent {
  return {
    tenantId: createTenantId("tenant-1"),
    type: SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
    data: {
      tenantId: "tenant-1",
      sessionId: SESSION_ID,
      sessionKeySource: "provider",
      agent,
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

function logFactsEvent({
  facts,
  traceId = null,
  timeMs = 1_500,
  agent = "claude_code",
}: {
  facts: Record<string, string | number | boolean>;
  traceId?: string | null;
  timeMs?: number;
  agent?: string;
}): LogFactsContributedEvent {
  return {
    tenantId: createTenantId("tenant-1"),
    type: LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
    data: {
      tenantId: "tenant-1",
      sessionId: SESSION_ID,
      sessionKeySource: "provider",
      agent,
      occurredAt: timeMs,
      recordId: `rec-${timeMs}`,
      traceId,
      spanId: null,
      timeUnixMs: timeMs,
      severityNumber: 9,
      providerKind: "claude_code",
      scopeName: "com.anthropic.claude_code.events",
      facts,
    },
  } as unknown as LogFactsContributedEvent;
}

function metricFactsEvent({
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

describe("CodingAgentSessionFoldProjection", () => {
  describe("when a model-call span contributes", () => {
    /** @scenario a session assembles from spans, logs and metrics */
    it("folds tokens, stop reason and the trace id into the session", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "claude_code.llm_request",
          spanId: "llm-1",
          facts: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: 900,
            stop_reason: "end_turn",
            request_id: "req_1",
          },
        }),
        initStateOf(projection),
      );

      expect(state.modelCalls).toBe(1);
      expect(state.inputTokens).toBe(100);
      expect(state.cacheReadTokens).toBe(900);
      expect(state.stopReason).toBe("end_turn");
      expect(state.finalRequestId).toBe("req_1");
      expect(state.traceIds).toEqual([TRACE_A]);
      expect(state.sessionId).toBe(SESSION_ID);
      expect(state.agent).toBe("claude_code");
    });

    /** @scenario "The session's cost is computed from tokens, same formula as the trace" */
    it("computes the span's cost and keeps the reported figure beside it", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      // What the agent states it was billed for the turn.
      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: { "event.name": "claude_code.api_request", cost_usd: 0.25 },
        }),
        state,
      );

      state = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "claude_code.llm_request",
          spanId: "llm-priced",
          facts: {
            model: "claude-sonnet-4-5",
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: 900,
          },
        }),
        state,
      );

      // Two figures, two homes: the session's cost is the span's tokens
      // priced against the registry — the same formula the trace pipeline
      // applies to the same span — and what the agent reported rides beside
      // it. Folding either into the other would charge the turn twice, at
      // two different rates.
      expect(state.agentReportedCostUsd).toBe(0.25);
      // 100 in x $3/M + 50 out x $15/M + 900 cache-read x $0.30/M.
      expect(state.costUsd).toBeCloseTo(0.00132, 6);
    });
  });

  describe("when claude llm_request spans price their cache writes", () => {
    const pricedCall = (context: string | undefined) => {
      const projection = makeProjection();
      return projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "claude_code.llm_request",
          spanId: `llm-ttl-${context ?? "none"}`,
          facts: {
            model: "claude-sonnet-4-5",
            cache_creation_tokens: 17_854,
            ...(context !== undefined
              ? { "llm_request.context": context }
              : {}),
          },
        }),
        initStateOf(projection),
      );
    };

    it("prices a main-thread call's writes at the hour-long rate", () => {
      // 17,854 writes at sonnet-4.5's $6/M hour-long rate vs $3.75/M
      // five-minute rate — the same lifetime rule the trace pipeline's
      // extractor stamps on the identical span.
      expect(pricedCall("interaction").costUsd).toBeCloseTo(
        17_854 * 0.000006,
        6,
      );
    });

    it("prices a sub-agent call's writes at the five-minute rate", () => {
      expect(pricedCall("tool").costUsd).toBeCloseTo(17_854 * 0.00000375, 6);
    });

    it("prices a call with no stated context conservatively", () => {
      expect(pricedCall(undefined).costUsd).toBeCloseTo(17_854 * 0.00000375, 6);
    });

    /** @scenario "A main-thread call known only by its query source prices the same way" */
    it("prices a call named main-thread by its query source at the hour-long rate", () => {
      const projection = makeProjection();
      const state = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "claude_code.llm_request",
          spanId: "llm-ttl-query-source",
          facts: {
            model: "claude-sonnet-4-5",
            cache_creation_tokens: 17_854,
            query_source: "repl_main_thread",
          },
        }),
        initStateOf(projection),
      );

      expect(state.costUsd).toBeCloseTo(17_854 * 0.000006, 6);
    });
  });

  describe("when a tool span FAILED", () => {
    // The contribution carries the OTLP numeric enum (ERROR = 2); PR #5708's
    // string comparison could never be true and every failure folded as a
    // success. The schema now forbids the string shape; the fold must still
    // read the number correctly.
    it("counts the failure and marks the step where it happened", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "claude_code.tool",
          spanId: "tool-err",
          facts: { tool_name: "Bash" },
          statusCode: 2,
        }),
        initStateOf(projection),
      );

      expect(state.failedTools).toBe(1);
      expect(state.steps[0]!.failed).toBe(true);
    });

    it("leaves a successful tool alone", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "claude_code.tool",
          spanId: "tool-ok",
          facts: { tool_name: "Read" },
          statusCode: 1,
        }),
        initStateOf(projection),
      );

      expect(state.failedTools).toBe(0);
      expect(state.steps[0]!.failed).toBe(false);
    });
  });

  describe("when a sub-agent's trace contributes to the same session", () => {
    /** @scenario a sub-agent run stays inside its parent session */
    it("collects both traces on one session without double-counting", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "claude_code.tool",
          spanId: "tool-1",
          traceId: TRACE_A,
          facts: { tool_name: "Bash" },
        }),
        state,
      );
      state = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "claude_code.tool",
          spanId: "tool-2",
          traceId: TRACE_B,
          facts: { tool_name: "Read", agent_id: "sub-1" },
        }),
        state,
      );

      expect(state.traceIds).toEqual([TRACE_A, TRACE_B]);
      expect(state.toolCalls).toBe(2);
      expect(state.subAgents).toBe(1);
      // The sub-agent's own reads stay out of the main step sequence.
      expect(state.steps.map((s) => s.name)).toEqual(["Bash"]);
    });
  });

  describe("when the human denies a tool", () => {
    /** @scenario a denied tool is part of the session story */
    it("records the denial from the log facts, span or no span", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: {
            "event.name": "claude_code.tool_decision",
            decision: "reject",
            source: "user_permanent",
          },
        }),
        initStateOf(projection),
      );

      expect(state.toolsDenied).toBe(1);
      // No correlation on the record — the session still counted it.
      expect(state.traceIds).toEqual([]);
    });
  });

  describe("when the agent reports its own bill on a log", () => {
    /** @scenario "The agent-reported figure is kept as a drift signal" */
    /** @scenario "an agent that states its own price keeps it beside the computed one" */
    it("sums it beside the computed cost, never into it", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: { "event.name": "claude_code.api_request", cost_usd: 0.25 },
        }),
        state,
      );
      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: { "event.name": "claude_code.api_request", cost_usd: 0.5 },
          timeMs: 2_500,
        }),
        state,
      );

      expect(state.agentReportedCostUsd).toBe(0.75);
      // The session's cost is computed from its spans' tokens; a span-bearing
      // agent's api_request event contributes only the reported figure.
      expect(state.costUsd).toBe(0);
    });
  });

  describe("when the agent reports rate-limit events", () => {
    /** @scenario a reported rate limit is counted apart from an inferred one */
    it("counts them apart from the 429-inferred counter", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: { "event.name": "claude_code.rate_limit_event" },
        }),
        state,
      );
      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: { "event.name": "claude_code.rate_limit_info" },
          timeMs: 2_500,
        }),
        state,
      );
      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: { "event.name": "claude_code.api_error", status_code: "429" },
          timeMs: 3_500,
        }),
        state,
      );

      // Both reported carriers land on the same counter; the 429-inferred
      // one answers a different question and is untouched by them.
      expect(state.rateLimitEvents).toBe(2);
      expect(state.rateLimited).toBe(1);
      expect(state.apiErrors).toBe(1);
    });
  });

  describe("when compactions arrive with and without a trigger", () => {
    /** @scenario compactions are told apart by what triggered them */
    it("tallies the trigger kinds, bucketing the unnamed as unknown", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      for (const [timeMs, trigger] of [
        [1_500, "auto"],
        [2_500, "auto"],
        [3_500, "manual"],
      ] as const) {
        state = projection.handleCodingAgentSessionLogFactsContributed(
          logFactsEvent({
            facts: {
              "event.name": "claude_code.compaction",
              pre_tokens: 100_000,
              post_tokens: 20_000,
              trigger,
            },
            timeMs,
          }),
          state,
        );
      }
      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: {
            "event.name": "claude_code.compaction",
            pre_tokens: 90_000,
            post_tokens: 15_000,
          },
          timeMs: 4_500,
        }),
        state,
      );

      expect(state.compactions).toBe(4);
      expect(state.compactionTriggers).toEqual({
        auto: 2,
        manual: 1,
        unknown: 1,
      });
    });
  });

  describe("when telemetry names the session's parent", () => {
    /** @scenario a spawned session knows its parent */
    it("keeps the first parent and the fork flag once set", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: {
            "event.name": "claude_code.user_prompt",
            parent_session_id: "parent-1",
            is_fork: true,
          },
        }),
        state,
      );
      // A later record naming a different parent does not move it: a session
      // has one parent, and a fork stays a fork.
      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: {
            "event.name": "claude_code.user_prompt",
            parent_session_id: "parent-2",
            is_fork: false,
          },
          timeMs: 2_500,
        }),
        state,
      );

      expect(state.parentSessionId).toBe("parent-1");
      expect(state.isFork).toBe(true);
    });
  });

  describe("when the LangWatch companion event names the session's checkout", () => {
    const contextFacts = (
      overrides: Record<string, string | number | boolean> = {},
    ): Record<string, string | number | boolean> => ({
      "event.name": "langwatch.session_context",
      "vcs.repository.host": "github.com",
      "vcs.repository.owner": "acme",
      "vcs.repository.name": "widgets",
      "vcs.ref.head.name": "main",
      "vcs.worktree.name": "widgets",
      ...overrides,
    });

    /** @scenario Repository identity and worktree set once and do not move */
    it("keeps the first repository and worktree when a later event names another", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({ facts: contextFacts() }),
        state,
      );
      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: contextFacts({
            "vcs.repository.host": "gitlab.com",
            "vcs.repository.owner": "other",
            "vcs.repository.name": "gadgets",
            "vcs.worktree.name": "gadgets-hotfix",
          }),
          timeMs: 2_500,
        }),
        state,
      );

      expect(state.repositoryHost).toBe("github.com");
      expect(state.repositoryOwner).toBe("acme");
      expect(state.repositoryName).toBe("widgets");
      expect(state.gitWorktree).toBe("widgets");
    });

    /** @scenario The branch follows the latest session context event */
    it("moves the branch to the one the session ended on", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({ facts: contextFacts() }),
        state,
      );
      expect(state.gitBranch).toBe("main");

      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: contextFacts({ "vcs.ref.head.name": "feat/git-context" }),
          timeMs: 2_500,
        }),
        state,
      );

      expect(state.gitBranch).toBe("feat/git-context");
      // A later event that reports no branch at all leaves the last one alone.
      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: contextFacts({ "vcs.ref.head.name": "" }),
          timeMs: 3_500,
        }),
        state,
      );
      expect(state.gitBranch).toBe("feat/git-context");
    });

    /** @scenario Every branch a session reports joins its branch set, first seen first */
    it("keeps every branch it drove, oldest first, alongside the current one", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({ facts: contextFacts() }),
        state,
      );
      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: contextFacts({ "vcs.ref.head.name": "feat/sessions-screen" }),
          timeMs: 2_500,
        }),
        state,
      );

      expect(state.gitBranches).toEqual(["main", "feat/sessions-screen"]);
      // The scalar stays the present tense: the branch the session is in.
      expect(state.gitBranch).toBe("feat/sessions-screen");
    });

    /** @scenario A branch reported twice joins the set once */
    it("names a branch once however often the session returns to it", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      for (const [index, branch] of [
        "main",
        "feat/a",
        "main",
        "feat/a",
      ].entries()) {
        state = projection.handleCodingAgentSessionLogFactsContributed(
          logFactsEvent({
            facts: contextFacts({ "vcs.ref.head.name": branch }),
            timeMs: 1_000 + index * 500,
          }),
          state,
        );
      }

      expect(state.gitBranches).toEqual(["main", "feat/a"]);
      expect(state.gitBranch).toBe("feat/a");
    });

    /** @scenario The branch set stops growing at its bound */
    it("holds the first branches it saw once the set is full", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      for (let index = 0; index < MAX_SET + 10; index++) {
        state = projection.handleCodingAgentSessionLogFactsContributed(
          logFactsEvent({
            facts: contextFacts({ "vcs.ref.head.name": `feat/${index}` }),
            timeMs: 1_000 + index,
          }),
          state,
        );
      }

      expect(state.gitBranches).toHaveLength(MAX_SET);
      expect(state.gitBranches[0]).toBe("feat/0");
      expect(state.gitBranches).not.toContain(`feat/${MAX_SET}`);
      // The bound caps the SET, never the current branch.
      expect(state.gitBranch).toBe(`feat/${MAX_SET + 9}`);
    });

    /** @scenario A session context event from Codex folds its git identity */
    /** @scenario A session context event from opencode folds its git identity */
    it.each([
      "codex",
      "opencode",
    ])("folds the same identity for %s, because nothing in the fold is per-agent", (agent) => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent,
          facts: contextFacts({ "coding_agent.name": agent }),
        }),
        state,
      );

      expect(state.repositoryHost).toBe("github.com");
      expect(state.repositoryOwner).toBe("acme");
      expect(state.repositoryName).toBe("widgets");
      expect(state.gitBranch).toBe("main");
      expect(state.gitWorktree).toBe("widgets");
    });
  });

  describe("when the generated conversation title arrives", () => {
    /** @scenario The title lifts from a generate_session_title response body, capped */
    it("takes the latest non-empty title", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: {
            "event.name": "claude_code.api_response_body",
            "langwatch.session.title": "Fix the flaky fold test",
          },
        }),
        state,
      );
      expect(state.title).toBe("Fix the flaky fold test");

      // A model call with no title stamped leaves the last one standing.
      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: { "event.name": "claude_code.api_response_body" },
          timeMs: 2_500,
        }),
        state,
      );
      expect(state.title).toBe("Fix the flaky fold test");

      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: {
            "event.name": "claude_code.api_response_body",
            "langwatch.session.title": "Add git context to the session row",
          },
          timeMs: 3_500,
        }),
        state,
      );
      expect(state.title).toBe("Add git context to the session row");
      // The title rides a log event, never a model call: the response body is
      // Claude's second half of a call its api_request already counted.
      expect(state.modelCalls).toBe(0);
    });
  });

  describe("when the session earns its name from a prompt", () => {
    const promptFacts = (
      title: string,
    ): Record<string, string | number | boolean> => ({
      "event.name": "claude_code.user_prompt",
      prompt_length: title.length,
      "langwatch.session.title_fallback": title,
    });

    /** @scenario A session with no generated title is named by the first thing the user asked */
    it("names an unnamed session by its first prompt and keeps that name", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: promptFacts("Fix the retry loop in the outbox worker"),
        }),
        state,
      );
      expect(state.title).toBe("Fix the retry loop in the outbox worker");

      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({ facts: promptFacts("Now the docs"), timeMs: 2_500 }),
        state,
      );
      expect(state.title).toBe("Fix the retry loop in the outbox worker");
      expect(state.prompts).toBe(2);
    });

    /** @scenario A generated title replaces the prompt-derived name */
    it("lets a generated title replace the prompt-derived name", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: promptFacts("fix flaky test please, the fold one"),
        }),
        state,
      );
      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: {
            "event.name": "claude_code.api_response_body",
            "langwatch.session.title": "Fix the flaky fold test",
          },
          timeMs: 2_500,
        }),
        state,
      );

      expect(state.title).toBe("Fix the flaky fold test");
    });

    /** @scenario The harvest names the session by the first thing the user asked */
    it("fills the name from the companion event and never overwrites one", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      const harvestContext = (
        title: string,
      ): Record<string, string | number | boolean> => ({
        "event.name": "langwatch.session_context",
        "coding_agent.name": "codex",
        "vcs.repository.host": "github.com",
        "vcs.repository.owner": "acme",
        "vcs.repository.name": "widgets",
        "langwatch.session.title": title,
      });

      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: harvestContext("Read notes.txt and summarize it"),
          agent: "codex",
        }),
        state,
      );
      expect(state.title).toBe("Read notes.txt and summarize it");

      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: harvestContext("A later re-post with another name"),
          agent: "codex",
          timeMs: 2_500,
        }),
        state,
      );
      expect(state.title).toBe("Read notes.txt and summarize it");
    });

    /** @scenario "The session's own name outranks the generated title" */
    /** @scenario "The session's own name outranks the prompt-derived name" */
    it("holds the session's name over both derived titles", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: {
            "event.name": "langwatch.session_context",
            "coding_agent.name": "claude_code",
            "langwatch.session.name": "pr-reviewer",
          },
        }),
        state,
      );
      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: promptFacts("Good morning. Use the review skill."),
          timeMs: 2_000,
        }),
        state,
      );
      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: {
            "event.name": "claude_code.api_response_body",
            "langwatch.session.title": "Review the open pull requests",
          },
          timeMs: 3_000,
        }),
        state,
      );

      // Neither the prompt nor the regenerated conversation title moved it.
      expect(state.title).toBe("pr-reviewer");
      expect(state.titleSource).toBe("name");
    });

    /** @scenario "A renamed session renames its row" */
    it("folds the newest name in place", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      const declared = (title: string) =>
        logFactsEvent({
          facts: {
            "event.name": "langwatch.session_context",
            "coding_agent.name": "claude_code",
            "langwatch.session.name": title,
          },
        });

      state = projection.handleCodingAgentSessionLogFactsContributed(
        declared("pr-reviewer"),
        state,
      );
      state = projection.handleCodingAgentSessionLogFactsContributed(
        declared("pr-hound"),
        state,
      );

      expect(state.title).toBe("pr-hound");
    });

    /** @scenario "A blank name does not rename the session" */
    it("keeps the previous title when a later name is whitespace", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      const declared = (title: string) =>
        logFactsEvent({
          facts: {
            "event.name": "langwatch.session_context",
            "coding_agent.name": "claude_code",
            "langwatch.session.name": title,
          },
        });

      state = projection.handleCodingAgentSessionLogFactsContributed(
        declared("pr-reviewer"),
        state,
      );
      state = projection.handleCodingAgentSessionLogFactsContributed(
        declared("   "),
        state,
      );

      expect(state.title).toBe("pr-reviewer");
    });

    /** @scenario "A context record with no repository still folds its titles" */
    it("folds a context that names no repository", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: {
            "event.name": "langwatch.session_context",
            "coding_agent.name": "codex",
            "langwatch.session.title": "Read notes.txt",
            "langwatch.session.name": "pr-reviewer",
          },
          agent: "codex",
        }),
        state,
      );

      expect(state.repositoryHost).toBeNull();
      expect(state.repositoryName).toBeNull();
      // The name wins over the prompt-derived title on the same record.
      expect(state.title).toBe("pr-reviewer");
      expect(state.titleSource).toBe("name");
    });

    /** @scenario "A row from before the source column still takes a generated title" */
    it("lets a generated title replace a title with no recorded source", () => {
      const projection = makeProjection();
      // A pre-00083 row decodes with a title and no source; it must keep the
      // old newest-wins behaviour rather than freezing on its first title.
      const decoded = {
        ...initStateOf(projection),
        title: "Good morning.",
        titleSource: null,
      };

      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: {
            "event.name": "claude_code.api_response_body",
            "langwatch.session.title": "Review the open pull requests",
          },
        }),
        decoded,
      );

      expect(state.title).toBe("Review the open pull requests");
      expect(state.titleSource).toBe("generated");
    });
  });

  describe("when a session sends only metrics", () => {
    /** @scenario a session that sent only metrics still appears */
    it("materializes the session from metric contributions alone", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionMetricFactsContributed(
        metricFactsEvent({
          seriesId: "s-lines-added",
          metricName: "claude_code.lines_of_code.count",
          attributes: { type: "added", "user.id": "user-1" },
          value: 120,
        }),
        state,
      );
      state = projection.handleCodingAgentSessionMetricFactsContributed(
        metricFactsEvent({
          seriesId: "s-commits",
          metricName: "claude_code.commit.count",
          value: 2,
        }),
        state,
      );

      expect(state.sessionId).toBe(SESSION_ID);
      expect(state.agent).toBe("claude_code");
      expect(state.userId).toBe("user-1");
      expect(state.linesAdded).toBe(120);
      expect(state.commits).toBe(2);
      expect(state.modelCalls).toBe(0);
      expect(state.traceIds).toEqual([]);
    });
  });

  describe("when a cumulative series is observed again", () => {
    /** @scenario re-delivered telemetry does not inflate a session */
    it("replaces the series' converged value instead of adding it", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionMetricFactsContributed(
        metricFactsEvent({
          seriesId: "s-lines-added",
          metricName: "claude_code.lines_of_code.count",
          attributes: { type: "added" },
          value: 120,
        }),
        state,
      );
      // The counter converged to a bigger total — same series, newer value.
      state = projection.handleCodingAgentSessionMetricFactsContributed(
        metricFactsEvent({
          seriesId: "s-lines-added",
          metricName: "claude_code.lines_of_code.count",
          attributes: { type: "added" },
          value: 150,
          asOfMs: 2_500,
        }),
        state,
      );

      expect(state.linesAdded).toBe(150);
    });

    it("sums distinct delta units exactly once each", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      for (const [unit, value] of [
        ["point-1", 10],
        ["point-2", 5],
      ] as const) {
        state = projection.handleCodingAgentSessionMetricFactsContributed(
          metricFactsEvent({
            seriesId: unit,
            metricName: "claude_code.lines_of_code.count",
            attributes: { type: "removed" },
            value,
          }),
          state,
        );
      }

      expect(state.linesRemoved).toBe(15);
    });
  });

  describe("when the human accepts and rejects edits", () => {
    it("splits the decisions and tracks the languages", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionMetricFactsContributed(
        metricFactsEvent({
          seriesId: "s-accept-ts",
          metricName: "claude_code.code_edit_tool.decision",
          attributes: { decision: "accept", language: "typescript" },
          value: 4,
        }),
        state,
      );
      state = projection.handleCodingAgentSessionMetricFactsContributed(
        metricFactsEvent({
          seriesId: "s-reject-ts",
          metricName: "claude_code.code_edit_tool.decision",
          attributes: { decision: "reject", language: "typescript" },
          value: 1,
        }),
        state,
      );

      expect(state.editsAccepted).toBe(4);
      expect(state.editsRejected).toBe(1);
      expect(state.languagesEdited).toEqual(["typescript"]);
    });
  });

  describe("when token metrics arrive for a session that also sent spans", () => {
    it("does not overlay them — the spans already carry the tokens", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);

      state = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "claude_code.llm_request",
          spanId: "llm-1",
          facts: { input_tokens: 100 },
        }),
        state,
      );
      state = projection.handleCodingAgentSessionMetricFactsContributed(
        metricFactsEvent({
          seriesId: "s-tokens",
          metricName: "claude_code.token.usage",
          attributes: { type: "input" },
          value: 100,
        }),
        state,
      );

      expect(state.inputTokens).toBe(100);
    });
  });

  describe("when the fold state is projected to its row", () => {
    it("keys the row by the aggregate's session id, traces as an array", () => {
      const projection = makeProjection();
      const state = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "claude_code.llm_request",
          spanId: "llm-1",
          facts: { input_tokens: 10 },
        }),
        initStateOf(projection),
      );

      const row = projectCodingAgentSessionToRow({
        state,
        tenantId: "tenant-1",
        sessionId: SESSION_ID,
        version: CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
      });

      expect(row.sessionId).toBe(SESSION_ID);
      expect(row.sessionKeySource).toBe("provider");
      expect(row.traceIds).toEqual([TRACE_A]);
      expect(row.inputTokens).toBe(10);
    });

    it("writes the git context and title as columns, empty when unreported", () => {
      const projection = makeProjection();
      let state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: {
            "event.name": "langwatch.session_context",
            "vcs.repository.host": "github.com",
            "vcs.repository.owner": "acme",
            "vcs.repository.name": "widgets",
            "vcs.ref.head.name": "feat/git-context",
            "vcs.worktree.name": "widgets-feat",
          },
        }),
        initStateOf(projection),
      );
      state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          facts: {
            "event.name": "claude_code.api_response_body",
            "langwatch.session.title": "Add git context to the session row",
          },
          timeMs: 2_500,
        }),
        state,
      );

      const row = projectCodingAgentSessionToRow({
        state,
        tenantId: "tenant-1",
        sessionId: SESSION_ID,
        version: CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
      });

      expect(row.repositoryHost).toBe("github.com");
      expect(row.repositoryOwner).toBe("acme");
      expect(row.repositoryName).toBe("widgets");
      expect(row.gitBranch).toBe("feat/git-context");
      expect(row.gitWorktree).toBe("widgets-feat");
      expect(row.title).toBe("Add git context to the session row");

      // A session whose agent has no companion emitter writes the empty
      // string, and reads back as "nothing reported this".
      const bare = projectCodingAgentSessionToRow({
        state: initStateOf(projection),
        tenantId: "tenant-1",
        sessionId: SESSION_ID,
        version: CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
      });
      expect(bare.repositoryHost).toBe("");
      expect(bare.gitBranch).toBe("");
      expect(bare.title).toBe("");
      expect(bare.gitBranches).toEqual([]);
      expect(codingAgentSessionStateFromRow(bare).repositoryHost).toBeNull();
      expect(codingAgentSessionStateFromRow(bare).gitBranch).toBeNull();
      expect(codingAgentSessionStateFromRow(bare).title).toBeNull();
      expect(codingAgentSessionStateFromRow(bare).gitBranches).toEqual([]);
    });

    it("writes every branch the session drove, and decodes them back", () => {
      const projection = makeProjection();
      let state = initStateOf(projection);
      for (const [index, branch] of ["main", "feat/two"].entries()) {
        state = projection.handleCodingAgentSessionLogFactsContributed(
          logFactsEvent({
            facts: {
              "event.name": "langwatch.session_context",
              "vcs.repository.owner": "acme",
              "vcs.repository.name": "widgets",
              "vcs.ref.head.name": branch,
            },
            timeMs: 1_000 + index * 500,
          }),
          state,
        );
      }

      const row = projectCodingAgentSessionToRow({
        state,
        tenantId: "tenant-1",
        sessionId: SESSION_ID,
        version: CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
      });

      expect(row.gitBranches).toEqual(["main", "feat/two"]);
      expect(row.gitBranch).toBe("feat/two");
      expect(codingAgentSessionStateFromRow(row).gitBranches).toEqual([
        "main",
        "feat/two",
      ]);
    });
  });
});

describe("read-back losslessness (ADR-066)", () => {
  describe("when a folded session is projected to a row and rebuilt", () => {
    /**
     * The outage fix depends on this exactly: store.get() reads working state
     * back by decoding the row, instead of replaying event_log. If any field the
     * fold needs fails to round-trip, a cache miss would silently fold onto
     * partial state — so this asserts the WHOLE state survives, and calls out the
     * previously-lossy bookkeeping fields by name.
     */
    it("recovers the identical working state, including the bookkeeping the old row dropped", () => {
      const projection = makeProjection();
      let state = projection.init();

      // A model call: tokens, a sub-agent id (the dedup set), the previous-call
      // context that drives cache-rebuild detection, the final request id.
      state = projection.apply(
        state,
        spanFactsEvent({
          name: "claude_code.llm_request",
          spanId: "llm-1",
          startMs: 1_000,
          endMs: 2_000,
          facts: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: 800,
            cache_creation_tokens: 200,
            agent_id: "sub-agent-1",
            request_id: "req_final",
            stop_reason: "end_turn",
          },
        }),
      );
      // A tool span: a step that carries its own start time (the parallel array
      // the 3-tuple row column used to drop).
      state = projection.apply(
        state,
        spanFactsEvent({
          name: "claude_code.tool",
          spanId: "tool-1",
          startMs: 3_000,
          endMs: 3_500,
          facts: { tool_name: "Read", file_path: "/a.ts" },
        }),
      );
      // A metric contribution: a converged unit in metricSeries + a metric-fed
      // field recomputed from it.
      state = projection.apply(
        state,
        metricFactsEvent({
          seriesId: "loc-added",
          metricName: "claude_code.lines_of_code.count",
          attributes: { type: "added" },
          value: 42,
        }),
      );

      // The fields the pre-ADR-066 row could not represent are actually populated.
      expect(state.subAgentIds).toEqual(["sub-agent-1"]);
      expect(state.previousCallContextTokens).toBe(1_000);
      expect(state.steps[0]?.startedAtMs).toBe(3_000);
      expect(Object.keys(state.metricSeries)).toContain("loc-added");
      expect(state.linesAdded).toBe(42);

      const row = projectCodingAgentSessionToRow({
        state,
        tenantId: "tenant-1",
        sessionId: SESSION_ID,
        version: CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
      });

      const decoded = codingAgentSessionStateFromRow(row);

      expect(decoded).toEqual(state);
    });
  });

  /**
   * The round-trip above proves the bookkeeping survives the row. These prove
   * why that matters: each one folds a further contribution onto the recovered
   * state, and contrasts it with the same contribution folded onto a state
   * whose bookkeeping did NOT survive — which is exactly the shape a row
   * written before these columns existed decodes to, and exactly why the store
   * refuses such a row instead of reading it back.
   */
  describe("when a further contribution folds onto the recovered state", () => {
    /** Round-trips a state through the row the fold would have committed. */
    function recover(state: CodingAgentSessionState): CodingAgentSessionState {
      return codingAgentSessionStateFromRow(
        projectCodingAgentSessionToRow({
          state,
          tenantId: "tenant-1",
          sessionId: SESSION_ID,
          version: CODING_AGENT_SESSION_PROJECTION_VERSION_LATEST,
        }),
      );
    }

    /** @scenario recovered state preserves the fold's internal bookkeeping */
    it("recognises a sub-agent it has already seen and still reads the prior call's context", () => {
      const projection = makeProjection();
      const modelCall = (facts: Record<string, string | number>) =>
        spanFactsEvent({
          name: "claude_code.llm_request",
          spanId: "llm",
          facts,
        });

      let state = projection.apply(
        projection.init(),
        modelCall({ agent_id: "sub-a", cache_read_tokens: 400 }),
      );
      state = projection.apply(
        state,
        modelCall({
          agent_id: "sub-b",
          cache_read_tokens: 800,
          cache_creation_tokens: 200,
        }),
      );
      expect(state.subAgents).toBe(2);

      // A third call from a sub-agent already counted, whose cache creation
      // dwarfs the previous call's context — a rebuild, but only if the fold
      // still knows what that context was.
      const third = modelCall({
        agent_id: "sub-a",
        cache_creation_tokens: 5_000,
      });

      const next = projection.apply(recover(state), third);

      expect(next.subAgents).toBe(2);
      expect(next.cacheRebuildCount).toBe(1);

      // The same contribution onto a state that lost the dedup set and the
      // prior context: the sub-agent count collapses to the one id it can see,
      // and the rebuild reads as the session's first call.
      const withoutBookkeeping = projection.apply(
        { ...recover(state), subAgentIds: [], previousCallContextTokens: 0 },
        third,
      );

      expect(withoutBookkeeping.subAgents).toBe(1);
      expect(withoutBookkeeping.cacheRebuildCount).toBe(0);
    });

    /** @scenario a total recomputed from its recorded parts is not collapsed by the next part */
    it("adds the new series to the ones already recorded instead of recomputing from it alone", () => {
      const projection = makeProjection();
      const linesAdded = (seriesId: string, value: number) =>
        metricFactsEvent({
          seriesId,
          metricName: "claude_code.lines_of_code.count",
          attributes: { type: "added" },
          value,
        });

      let state = projection.apply(projection.init(), linesAdded("loc-1", 40));
      state = projection.apply(state, linesAdded("loc-2", 2));
      expect(state.linesAdded).toBe(42);

      const next = projection.apply(recover(state), linesAdded("loc-3", 5));

      expect(next.linesAdded).toBe(47);

      // The total is recomputed WHOLE from the recorded series, so a state that
      // lost them recomputes from the newest one alone.
      const withoutParts = projection.apply(
        { ...recover(state), metricSeries: {} },
        linesAdded("loc-3", 5),
      );

      expect(withoutParts.linesAdded).toBe(5);
    });

    /** @scenario a sequence keeps the order things happened in rather than the order they arrived */
    it("places a late-arriving step by when it started, not by when it turned up", () => {
      const projection = makeProjection();
      const toolAt = (spanId: string, tool: string, startMs: number) =>
        spanFactsEvent({
          name: "claude_code.tool",
          spanId,
          startMs,
          endMs: startMs + 100,
          facts: { tool_name: tool },
        });

      let state = projection.apply(
        projection.init(),
        toolAt("t1", "Read", 3_000),
      );
      state = projection.apply(state, toolAt("t2", "Bash", 5_000));

      // Spans are batched on the wire, so this one lands last despite having
      // started between the other two.
      const late = toolAt("t3", "Grep", 4_000);

      const next = projection.apply(recover(state), late);

      expect(next.steps.map((step) => step.name)).toEqual([
        "Read",
        "Grep",
        "Bash",
      ]);

      // Without the recorded start times every earlier step reads as time zero,
      // so the late step can only be appended — the order the spans arrived in.
      const withoutTimes = projection.apply(
        {
          ...recover(state),
          steps: state.steps.map((step) => ({ ...step, startedAtMs: 0 })),
        },
        late,
      );

      expect(withoutTimes.steps.map((step) => step.name)).toEqual([
        "Read",
        "Bash",
        "Grep",
      ]);
    });
  });
});

describe("coding-agent session fold, per-agent gating", () => {
  describe("when a Cowork session folds from events only", () => {
    /** @scenario a Cowork session is an agent session */
    it("folds the model call — tokens, model, cost — from the api_request event", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent: "claude_cowork",
          facts: {
            "event.name": "claude_code.api_request",
            cost_usd: 0.42,
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: 1_000,
            cache_creation_tokens: 200,
            model: "claude-fable-5",
            duration_ms: 800,
          },
        }),
        initStateOf(projection),
      );

      expect(state.agent).toBe("claude_cowork");
      expect(state.modelCalls).toBe(1);
      expect(state.inputTokens).toBe(100);
      expect(state.outputTokens).toBe(50);
      expect(state.cacheReadTokens).toBe(1_000);
      expect(state.cacheCreationTokens).toBe(200);
      expect(state.models).toEqual(["claude-fable-5"]);
      expect(state.costUsd).toBeCloseTo(0.42);
    });

    /** @scenario "A logs-only agent keeps its reported cost as the session cost" */
    it("keeps the reported cost as the session's cost, with no span to compute from", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent: "claude_cowork",
          facts: {
            "event.name": "claude_code.api_request",
            cost_usd: 0.42,
            model: "claude-fable-5",
          },
        }),
        initStateOf(projection),
      );

      expect(state.costUsd).toBeCloseTo(0.42);
      expect(state.agentReportedCostUsd).toBeCloseTo(0.42);
    });

    it("folds the tool run — name, count, step — from the tool_result event", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent: "claude_cowork",
          timeMs: 2_000,
          facts: {
            "event.name": "claude_code.tool_result",
            tool_name: "Bash",
            success: "true",
            duration_ms: 120,
            tool_result_size_bytes: 2_048,
          },
        }),
        initStateOf(projection),
      );

      expect(state.toolCalls).toBe(1);
      expect(state.toolCounts).toEqual({ Bash: 1 });
      expect(state.steps).toEqual([
        { name: "Bash", count: 1, startedAtMs: 2_000, failed: false },
      ]);
      expect(state.toolResultBytes).toBe(2_048);
    });

    /** @scenario a Cowork session is an agent session */
    it("counts a turn once when the beta trace export also emits its span", () => {
      const projection = makeProjection();
      const modelFacts = {
        model: "claude-fable-5",
        input_tokens: 100,
        output_tokens: 50,
      };

      // Cowork behind its beta trace-export flag: the SAME turn arrives twice,
      // once as Claude Code's llm_request span and once as the api_request
      // event Cowork folds its model calls from.
      const afterSpan = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "claude_code.llm_request",
          spanId: "cw-llm-1",
          agent: "claude_cowork",
          facts: modelFacts,
        }),
        initStateOf(projection),
      );
      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent: "claude_cowork",
          facts: { "event.name": "claude_code.api_request", ...modelFacts },
        }),
        afterSpan,
      );

      expect(state.modelCalls).toBe(1);
      expect(state.inputTokens).toBe(100);
      expect(state.outputTokens).toBe(50);
    });

    /** @scenario a Cowork session is an agent session */
    it("counts a tool run once when the beta trace export also emits its span", () => {
      const projection = makeProjection();

      const afterSpan = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "claude_code.tool",
          spanId: "cw-tool-1",
          agent: "claude_cowork",
          facts: { tool_name: "Bash", duration_ms: 120 },
        }),
        initStateOf(projection),
      );
      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent: "claude_cowork",
          timeMs: 2_000,
          facts: {
            "event.name": "claude_code.tool_result",
            tool_name: "Bash",
            success: "true",
            duration_ms: 120,
          },
        }),
        afterSpan,
      );

      expect(state.toolCalls).toBe(1);
      expect(state.toolCounts).toEqual({ Bash: 1 });
    });

    it("identifies the user from Cowork's account uuid", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent: "claude_cowork",
          facts: {
            "event.name": "claude_code.user_prompt",
            prompt_length: 12,
            "user.account_uuid": "0f6f44f5-2f4c-4a5e-9d3b-7f8f2f9a1b2c",
          },
        }),
        initStateOf(projection),
      );

      expect(state.userId).toBe("0f6f44f5-2f4c-4a5e-9d3b-7f8f2f9a1b2c");
    });
  });

  describe("when a span-bearing agent's api_request event contributes", () => {
    /** @scenario re-delivered telemetry does not inflate a session */
    it("folds the reported cost only — its tokens arrive on the llm_request span", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent: "claude_code",
          facts: {
            "event.name": "claude_code.api_request",
            cost_usd: 0.42,
            input_tokens: 100,
            output_tokens: 50,
          },
        }),
        initStateOf(projection),
      );

      expect(state.agentReportedCostUsd).toBeCloseTo(0.42);
      // The double-count gate: these fold from the span for claude_code,
      // including the computed cost.
      expect(state.costUsd).toBe(0);
      expect(state.modelCalls).toBe(0);
      expect(state.inputTokens).toBe(0);
      expect(state.outputTokens).toBe(0);
    });
  });

  describe("when a span-bearing agent's tool_result event contributes", () => {
    /** @scenario re-delivered telemetry does not inflate a session */
    it("folds result bytes only — the run itself arrives on the tool span", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent: "claude_code",
          facts: {
            "event.name": "claude_code.tool_result",
            tool_name: "Bash",
            success: "true",
            duration_ms: 120,
            tool_result_size_bytes: 2_048,
          },
        }),
        initStateOf(projection),
      );

      expect(state.toolResultBytes).toBe(2_048);
      // The other half of the gate — untested until now, and the half that
      // would double every Claude Code tool run if it regressed.
      expect(state.toolCalls).toBe(0);
      expect(state.toolCounts).toEqual({});
      expect(state.steps).toEqual([]);
    });
  });
});

describe("coding-agent session fold, codex", () => {
  /**
   * A live turn span from codex-rs 0.147, as the fold receives it: after
   * canonicalisation, where the input has already been made the disjoint
   * non-cached bucket (2936 of the 13944 codex reported, the other 11008
   * being the cache read).
   */
  const codexTurnFacts = {
    "gen_ai.request.model": "gpt-5.6-sol",
    "gen_ai.response.model": "gpt-5.6-sol",
    "gen_ai.usage.input_tokens": "2936",
    "gen_ai.usage.output_tokens": "7",
    "gen_ai.usage.cache_read.input_tokens": "11008",
    "gen_ai.usage.cache_creation.input_tokens": "0",
    "codex.turn.token_usage.non_cached_input_tokens": "2936",
  };

  describe("when a codex turn span contributes", () => {
    /** @scenario "a codex turn span folds the turn's model call and tokens" */
    it("folds the turn as a model call with disjoint token buckets", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "session_task.turn",
          spanId: "turn-1",
          agent: "codex",
          facts: codexTurnFacts,
          startMs: 1_000,
          endMs: 8_355,
        }),
        initStateOf(projection),
      );

      expect(state.modelCalls).toBe(1);
      expect(state.models).toEqual(["gpt-5.6-sol"]);
      // codex's gen_ai input INCLUDES the cache buckets; the fold keeps the
      // disjoint convention, so input here is the non-cached count.
      expect(state.inputTokens).toBe(2_936);
      expect(state.outputTokens).toBe(7);
      expect(state.cacheReadTokens).toBe(11_008);
      expect(state.cacheCreationTokens).toBe(0);
      expect(state.peakContextTokens).toBe(11_008);
      // The turn's wall time includes the tools that ran inside it, so it
      // does not pretend to be model latency.
      expect(state.modelCallMs).toBe(0);
      expect(state.attempts).toBe(1);
    });

    /** @scenario "a codex session is priced from the tokens it reported" */
    it("prices the turn from its tokens, since codex states no cost", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "session_task.turn",
          spanId: "turn-priced",
          agent: "codex",
          facts: codexTurnFacts,
        }),
        initStateOf(projection),
      );

      // 2,936 non-cached input + 11,008 cache-read + 7 output at gpt-5.6-sol's
      // registry rates. The figure is the registry's, not one written here, so
      // the assertion is that a price was worked out at all.
      expect(state.costUsd).toBeGreaterThan(0);
      expect(state.costUsd).toBeLessThan(1);
    });

    /** @scenario "a codex session is priced from the tokens it reported" */
    it("adds a second turn's price to the session's total", () => {
      const projection = makeProjection();

      const first = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "session_task.turn",
          spanId: "turn-priced-1",
          agent: "codex",
          facts: codexTurnFacts,
        }),
        initStateOf(projection),
      );
      const second = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "session_task.turn",
          spanId: "turn-priced-2",
          agent: "codex",
          facts: codexTurnFacts,
        }),
        first,
      );

      expect(first.costUsd).toBeGreaterThan(0);
      expect(second.costUsd).toBeCloseTo(first.costUsd * 2, 10);
    });

    /** @scenario "a turn priced at an unknown model costs nothing rather than guessing" */
    it("counts the tokens but charges nothing for a model in no price list", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "session_task.turn",
          spanId: "turn-unpriced",
          agent: "codex",
          facts: {
            ...codexTurnFacts,
            "gen_ai.request.model": "a-model-no-registry-lists",
            "gen_ai.response.model": "a-model-no-registry-lists",
          },
        }),
        initStateOf(projection),
      );

      expect(state.inputTokens).toBe(2_936);
      expect(state.costUsd).toBe(0);
    });

    it("reads the input the canonicalisation settled on, without deriving it again", () => {
      const projection = makeProjection();
      const {
        "codex.turn.token_usage.non_cached_input_tokens": _omit,
        ...rest
      } = codexTurnFacts;

      const state = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "session_task.turn",
          spanId: "turn-2",
          agent: "codex",
          facts: rest,
        }),
        initStateOf(projection),
      );

      // Taking the cache off a second time would leave nothing here, which
      // is what a session whose turns all read zero input looked like.
      expect(state.inputTokens).toBe(2_936);
      expect(state.cacheReadTokens).toBe(11_008);
    });

    it("contributes identity only when the contribution is labeled as another agent", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionSpanFactsContributed(
        spanFactsEvent({
          name: "session_task.turn",
          spanId: "turn-3",
          agent: "unknown",
          facts: codexTurnFacts,
        }),
        initStateOf(projection),
      );

      expect(state.modelCalls).toBe(0);
      expect(state.inputTokens).toBe(0);
    });
  });

  describe("when a codex tool_result event contributes", () => {
    /** @scenario "a codex shell command counts once despite its sandbox outcome event" */
    it("folds the tool run from the event and drops the sandbox outcome", () => {
      const projection = makeProjection();

      const afterToolResult =
        projection.handleCodingAgentSessionLogFactsContributed(
          logFactsEvent({
            agent: "codex",
            timeMs: 2_000,
            facts: {
              "event.name": "codex.tool_result",
              tool_name: "shell",
              success: "true",
              duration_ms: 340,
            },
          }),
          initStateOf(projection),
        );
      // The SAME shell command also fires sandbox_outcome; mapping it onto
      // tool_result again would count the command twice.
      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent: "codex",
          timeMs: 2_001,
          facts: {
            "event.name": "codex.sandbox_outcome",
            tool_name: "shell",
            outcome: "success",
          },
        }),
        afterToolResult,
      );

      expect(state.toolCalls).toBe(1);
      expect(state.toolCounts).toEqual({ shell: 1 });
      expect(state.steps).toEqual([
        { name: "shell", count: 1, startedAtMs: 2_000, failed: false },
      ]);
      expect(state.toolMs).toBe(340);
    });

    /** @scenario "the codex script wrapper is plumbing, its commands are the tool runs" */
    it("counts the command inside a code-mode script, never the exec wrapper", () => {
      const projection = makeProjection();

      // Code mode: the model calls `exec` with a script, and the
      // `tools.exec_command(...)` inside re-enters codex's registry as its
      // own dispatch — BOTH layers report a tool_result for one command.
      const afterCommand =
        projection.handleCodingAgentSessionLogFactsContributed(
          logFactsEvent({
            agent: "codex",
            timeMs: 3_000,
            facts: {
              "event.name": "codex.tool_result",
              tool_name: "exec_command",
              success: "true",
              duration_ms: 47,
            },
          }),
          initStateOf(projection),
        );
      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent: "codex",
          timeMs: 3_001,
          facts: {
            "event.name": "codex.tool_result",
            tool_name: "exec",
            success: "true",
            duration_ms: 283,
          },
        }),
        afterCommand,
      );

      expect(state.toolCalls).toBe(1);
      expect(state.toolCounts).toEqual({ exec_command: 1 });
      expect(state.toolMs).toBe(47);
      expect(state.steps).toEqual([
        { name: "exec_command", count: 1, startedAtMs: 3_000, failed: false },
      ]);
    });

    it("reads codex's bare mcp_server spelling into the server set", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent: "codex",
          timeMs: 2_000,
          facts: {
            "event.name": "codex.tool_result",
            tool_name: "search",
            success: "true",
            duration_ms: 50,
            mcp_server: "grafana",
          },
        }),
        initStateOf(projection),
      );

      expect(state.mcpServers).toEqual(["grafana"]);
    });
  });

  describe("when the human answers codex's tool prompts", () => {
    /** @scenario "a codex denial and a codex abort are the human's decisions, not failures" */
    it("counts denied as a denial, and abort or timed_out as walking away", () => {
      const projection = makeProjection();
      const decide = (
        state: CodingAgentSessionState,
        decision: string,
        timeMs: number,
      ) =>
        projection.handleCodingAgentSessionLogFactsContributed(
          logFactsEvent({
            agent: "codex",
            timeMs,
            facts: {
              "event.name": "codex.tool_decision",
              tool_name: "shell",
              decision,
            },
          }),
          state,
        );

      let state = initStateOf(projection);
      state = decide(state, "approved", 1_000);
      state = decide(state, "denied", 1_001);
      state = decide(state, "denied_with_network_policy_deny", 1_002);
      state = decide(state, "abort", 1_003);
      state = decide(state, "timed_out", 1_004);

      expect(state.toolsDenied).toBe(2);
      expect(state.toolsAborted).toBe(2);
      expect(state.failedTools).toBe(0);
    });
  });

  describe("when codex reports time to first token", () => {
    /** @scenario "codex time to first token folds from its own event" */
    it("folds the turn_ttft event into the TTFT mean", () => {
      const projection = makeProjection();

      const first = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent: "codex",
          timeMs: 1_000,
          facts: { "event.name": "codex.turn_ttft", duration_ms: 1_200 },
        }),
        initStateOf(projection),
      );
      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent: "codex",
          timeMs: 2_000,
          facts: { "event.name": "codex.turn_ttft", duration_ms: 800 },
        }),
        first,
      );

      expect(state.ttftMsTotal).toBe(2_000);
      expect(state.ttftSamples).toBe(2);
      expect(meanTtftMs(state)).toBe(1_000);
    });
  });

  describe("when the rollout harvest reports the session's checkout", () => {
    /** @scenario "The harvest reports the repository the session worked on" */
    it("gives the codex session its repository and branch", () => {
      const projection = makeProjection();

      const state = projection.handleCodingAgentSessionLogFactsContributed(
        logFactsEvent({
          agent: "codex",
          facts: {
            "event.name": "langwatch.session_context",
            "coding_agent.name": "codex",
            "vcs.repository.host": "github.com",
            "vcs.repository.owner": "acme",
            "vcs.repository.name": "acme-app",
            "vcs.ref.head.name": "feat/pricing",
          },
        }),
        initStateOf(projection),
      );

      expect(state.repositoryHost).toBe("github.com");
      expect(state.repositoryOwner).toBe("acme");
      expect(state.repositoryName).toBe("acme-app");
      expect(state.gitBranch).toBe("feat/pricing");
      expect(state.gitBranches).toEqual(["feat/pricing"]);
    });
  });

  describe("the span gate for codex's bare-named spans", () => {
    it("admits the turn span on the codex scope and declines it elsewhere", () => {
      expect(
        isCodingAgentSessionSpan({
          name: "session_task.turn",
          scopeName: "codex_exec",
        }),
      ).toBe(true);
      expect(
        isCodingAgentSessionSpan({
          name: "session_task.turn",
          scopeName: "com.acme.pipeline",
        }),
      ).toBe(false);
      // handle_responses repeats the turn's tokens and carries a tokio
      // thread.id the session-key resolution would read as the session.
      expect(
        isCodingAgentSessionSpan({
          name: "handle_responses",
          scopeName: "codex_exec",
        }),
      ).toBe(false);
      // Claude's names carry their own namespace and need no scope.
      expect(
        isCodingAgentSessionSpan({ name: "claude_code.tool", scopeName: null }),
      ).toBe(true);
    });
  });
});
