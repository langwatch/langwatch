/**
 * Grok sessions lifted and folded as the pipeline does, from the canonical shape of the grok
 * 1.0.70 captures: scope `ai.xai.grok_code`, the event name in its own column, every attribute
 * flattened to a string. Ids and figures are the captures' own, with the identity scrubbed.
 * @see specs/coding-agent/grok-sessions.feature
 * @see specs/coding-agent/grok-model-calls.feature
 * @see specs/ai-governance/ingestion-sources/grok-cli-otlp.feature
 */

import {
  LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
  type LogFactsContributedEvent,
  METRIC_FACTS_CONTRIBUTED_EVENT_TYPE,
} from "@langwatch/coding-agent-contract";
import { createTenantId } from "@langwatch/eventing";
import type { CanonicalLogRecord } from "@langwatch/log-contract";
import { describe, expect, it } from "vitest";

import { TestModelProviderService } from "../../__tests__/fixtures/coding-agent-processing.fixture.ts";
import { ClaudeAnswersTraceCanonicalisation } from "../../__tests__/fixtures/trace-canonicalisation.fixture.ts";
import { liftLogContribution } from "../../rules/coding-agent-log-facts.rules.ts";
import { CodingAgentSessionEventsMapProjection } from "../coding-agent-session-events.projection.ts";
import {
  CodingAgentSessionFoldProjection,
  type CodingAgentSessionState,
} from "../coding-agent-session.projection.ts";

const PARENT = "01a196a8-0cb5-7c41-957b-3f0e5d2a9c10";
const CHILD = "01a196a8-2f61-7d02-8a44-91c7e0b3d5e2";
const OTHER = "01a196a9-11d0-7b9e-a2c3-5e8f7a6b4c3d";
const USER_ID = "4f1c2e9a-user-hash";
const EMAIL = "someone@example.com";
const GROK_SCOPE = "ai.xai.grok_code";
const GROK_RESOURCE = {
  "service.name": "grok-cli",
  "service.version": "1.0.70 (f50904eaee6c)",
  "app.entrypoint": "headless",
};
/** The catalogue price per call; Grok's own figure must win regardless. */
const CATALOGUE_PRICE_USD = 0.5;

let nextRecord = 0;

/** One stored Grok log record. Grok names its event in the record's own field, not an attribute. */
function grokRecord({
  eventName,
  sessionId,
  attributes = {},
  timeMs = 1_000,
}: {
  eventName: string;
  sessionId: string | null;
  attributes?: Record<string, string>;
  timeMs?: number;
}): CanonicalLogRecord {
  nextRecord += 1;
  const flat: Record<string, string> = {
    "event.sequence": String(nextRecord),
    "user.id": USER_ID,
    "user.email": EMAIL,
    ...(sessionId !== null ? { "session.id": sessionId } : {}),
    ...attributes,
  };
  return record({
    scopeName: GROK_SCOPE,
    eventName,
    attributes: flat,
    resource: GROK_RESOURCE,
    providerKind: "grok",
    timeMs,
  });
}

/** The record `langwatch ingest hook grok` posts, under the CLI's own scope and service. */
function contextRecord({
  sessionId,
  attributes,
  timeMs = 500,
}: {
  sessionId: string;
  attributes: Record<string, string>;
  timeMs?: number;
}): CanonicalLogRecord {
  return record({
    scopeName: "langwatch.coding_agent.hook",
    eventName: "langwatch.session_context",
    attributes: {
      "event.name": "langwatch.session_context",
      "session.id": sessionId,
      "coding_agent.name": "grok",
      ...attributes,
    },
    resource: { "service.name": "langwatch-cli" },
    providerKind: "generic",
    timeMs,
  });
}

function record({
  scopeName,
  eventName,
  attributes,
  resource,
  providerKind,
  timeMs,
}: {
  scopeName: string;
  eventName: string;
  attributes: Record<string, string>;
  resource: Record<string, string>;
  providerKind: CanonicalLogRecord["providerKind"];
  timeMs: number;
}): CanonicalLogRecord {
  return {
    tenantId: "project-1",
    organizationId: "organization-1",
    recordId: `${nextRecord}-${timeMs}`.padStart(64, "0"),
    resourceSchemaUrl: "",
    resourceAttributesJson: "[]",
    resourceAttributesFlatJson: JSON.stringify(resource),
    resourceAttributeKeys: Object.keys(resource),
    resourceDroppedAttributesCount: 0,
    scopeSchemaUrl: "",
    scopeName,
    scopeVersion: "",
    scopeAttributesJson: "[]",
    scopeAttributeKeys: [],
    scopeDroppedAttributesCount: 0,
    wireTraceId: "",
    wireSpanId: "",
    correlationTraceId: "",
    correlationSpanId: "",
    correlationSource: "none",
    timeUnixNano: `${timeMs}000000`,
    observedTimeUnixNano: `${timeMs}000000`,
    timeUnixMs: timeMs,
    severityNumber: 9,
    severityText: "INFO",
    bodyType: "empty",
    bodyJson: "null",
    bodyText: null,
    attributesJson: "[]",
    attributesFlatJson: JSON.stringify(attributes),
    attributeKeys: Object.keys(attributes),
    droppedAttributesCount: 0,
    flags: 0,
    eventName,
    providerKind,
    providerEventKind: "",
    providerEventSequence: "",
    providerSessionId: "",
    providerConversationId: "",
    providerPromptId: "",
    piiRedactionLevel: "DISABLED",
    canonicalPayload: "",
    canonicalSizeBytes: 0,
    occurredAt: timeMs,
    acceptedAt: timeMs,
  };
}

function userPrompt(sessionId: string, prompt: string, promptId = "p-1"): CanonicalLogRecord {
  return grokRecord({
    eventName: "grok_code.user_prompt",
    sessionId,
    attributes: {
      "prompt.id": promptId,
      prompt,
      prompt_length: String(prompt.length),
      model: "grok-4.7",
    },
  });
}

function apiRequest(
  sessionId: string,
  {
    input,
    cacheRead,
    output,
    micros,
  }: { input: number; cacheRead: number; output: number; micros?: number },
): CanonicalLogRecord {
  return grokRecord({
    eventName: "grok_code.api_request",
    sessionId,
    attributes: {
      "prompt.id": "p-1",
      model: "grok-4.7",
      duration_ms: "3783",
      input_tokens: String(input),
      output_tokens: String(output),
      reasoning_tokens: "244",
      cache_read_tokens: String(cacheRead),
      cache_creation_tokens: "0",
      ...(micros !== undefined ? { cost_usd_micros: String(micros) } : {}),
    },
  });
}

function toolResult(
  sessionId: string,
  toolName: string,
  extra: Record<string, string> = {},
): CanonicalLogRecord {
  return grokRecord({
    eventName: "grok_code.tool_result",
    sessionId,
    attributes: {
      tool_name: toolName,
      success: "True",
      duration_ms: "14",
      model: "grok-4.7",
      ...extra,
    },
  });
}

function makeProjection() {
  return CodingAgentSessionFoldProjection.create({
    store: { store: async () => {}, get: async () => ({ kind: "empty" as const }) },
    traceCanonicalisation: ClaudeAnswersTraceCanonicalisation.create(),
    modelProviders: new TestModelProviderService(() => CATALOGUE_PRICE_USD),
  });
}

/** The contribution events the records lift to, in order; an ignored record lifts to none. */
function logEvents(records: CanonicalLogRecord[]): LogFactsContributedEvent[] {
  return records.flatMap((stored) => {
    const lifted = liftLogContribution({
      record: stored,
      traces: ClaudeAnswersTraceCanonicalisation.create(),
    });
    if (lifted.outcome === "ignored") return [];
    const data = lifted.contribution;
    return [
      {
        id: `evt-${data.recordId}`,
        aggregateId: data.sessionId,
        aggregateType: "coding_agent_session",
        createdAt: data.occurredAt,
        occurredAt: data.occurredAt,
        version: "2025-01-01",
        tenantId: createTenantId(data.tenantId),
        type: LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
        data,
      },
    ];
  });
}

/** Lifts and folds the records in order, keyed by the session each lands in. */
function foldSessions(records: CanonicalLogRecord[]): Map<string, CodingAgentSessionState> {
  const projection = makeProjection();
  const sessions = new Map<string, CodingAgentSessionState>();
  for (const event of logEvents(records)) {
    const state = sessions.get(event.data.sessionId) ?? projection.init();
    sessions.set(
      event.data.sessionId,
      projection.handleCodingAgentSessionLogFactsContributed(event, state),
    );
  }
  return sessions;
}

function foldOne(records: CanonicalLogRecord[]): CodingAgentSessionState {
  const sessions = foldSessions(records);
  expect([...sessions.keys()]).toHaveLength(1);
  return [...sessions.values()][0]!;
}

/** One turn of a Grok session, in the order Grok emits it. */
function turn(sessionId: string): CanonicalLogRecord[] {
  return [
    userPrompt(sessionId, "<user_query>\nAdd a subtract function.\n</user_query>"),
    apiRequest(sessionId, { input: 25_852, cacheRead: 25_728, output: 98, micros: 51_116 }),
    toolResult(sessionId, "read_file"),
    grokRecord({
      eventName: "grok_code.assistant_response",
      sessionId,
      attributes: { response_length: "42", response: "Done." },
    }),
  ];
}

describe("Grok sessions", () => {
  describe("given the records of one Grok turn", () => {
    /** @scenario Grok's turn events are admitted to a Grok session */
    it("admits every one under the grok agent", () => {
      const events = logEvents(turn(PARENT));

      expect(events).toHaveLength(4);
      expect(events.map((event) => event.data.agent)).toEqual(["grok", "grok", "grok", "grok"]);
    });

    /** @scenario A Grok session becomes one row keyed by its session id */
    it("folds into one row keyed by Grok's session id, with the model and the tokens", () => {
      const sessions = foldSessions(turn(PARENT));

      expect([...sessions.keys()]).toEqual([PARENT]);
      const state = sessions.get(PARENT)!;
      expect(state.agent).toBe("grok");
      expect(state.models).toEqual(["grok-4.7"]);
      expect(state.inputTokens).toBe(124);
      expect(state.outputTokens).toBe(98);
    });
  });

  describe("given a Grok record with no session id", () => {
    /** @scenario A Grok record without a session id is ambient, not a session */
    it("skips an mcp_server_connection record", () => {
      const ambient = grokRecord({
        eventName: "grok_code.mcp_server_connection",
        sessionId: null,
        attributes: { status: "failed", duration_ms: "89" },
      });

      expect(logEvents([ambient])).toEqual([]);
    });

    /** @scenario Grok's subagent launch and completion events are not counted as sessions */
    it("skips a subagent launch record", () => {
      const launch = grokRecord({
        eventName: "grok_code.subagent",
        sessionId: null,
        attributes: { subagent_type: "general-purpose" },
      });

      expect(foldSessions([launch]).size).toBe(0);
    });
  });

  describe("given Grok's lifecycle events", () => {
    /** @scenario Grok's lifecycle events fold nothing and break nothing */
    it("folds the same row as without them", () => {
      const lifecycle = [
        grokRecord({ eventName: "grok_code.session_start", sessionId: PARENT }),
        grokRecord({ eventName: "grok_code.turn_completed", sessionId: PARENT }),
        grokRecord({
          eventName: "grok_code.model_switched",
          sessionId: PARENT,
          attributes: { from_model: "grok-4.7", to_model: "grok-4.7", success: "true" },
        }),
        grokRecord({ eventName: "grok_code.session_end", sessionId: PARENT }),
      ];

      const without = foldOne(turn(PARENT));
      const withLifecycle = foldOne([...turn(PARENT), ...lifecycle]);

      expect(withLifecycle.modelCalls).toBe(without.modelCalls);
      expect(withLifecycle.inputTokens).toBe(without.inputTokens);
      expect(withLifecycle.toolCalls).toBe(without.toolCalls);
      expect(withLifecycle.prompts).toBe(without.prompts);
      expect(withLifecycle.costUsd).toBeCloseTo(without.costUsd);
    });
  });

  describe("given a resumed Grok session", () => {
    /** @scenario A resumed Grok session keeps folding onto the same row */
    it("folds both processes' turns onto one row", () => {
      const state = foldOne([...turn(PARENT), ...turn(PARENT)]);

      expect(state.prompts).toBe(2);
      expect(state.modelCalls).toBe(2);
    });
  });

  describe("given two Grok sessions interleaved", () => {
    /** @scenario Two concurrent Grok sessions fold into two rows */
    it("folds two rows", () => {
      const [a, b] = [turn(PARENT), turn(OTHER)];
      const interleaved = a.flatMap((record, index) => [record, b[index]!]);

      expect([...foldSessions(interleaved).keys()].toSorted()).toEqual([PARENT, OTHER].toSorted());
    });
  });

  describe("given Grok's tool results", () => {
    /** @scenario Tool runs are counted under Grok's own tool names */
    it("counts each under Grok's own name", () => {
      const state = foldOne([
        toolResult(PARENT, "read_file"),
        toolResult(PARENT, "read_file"),
        toolResult(PARENT, "run_terminal_command"),
      ]);

      expect(state.toolCounts).toEqual({ read_file: 2, run_terminal_command: 1 });
    });

    /** @scenario A failed Grok tool run is counted as failed */
    it("counts Grok's capitalised False as a failure", () => {
      const state = foldOne([
        toolResult(PARENT, "read_file"),
        toolResult(PARENT, "run_terminal_command", { success: "False", outcome: "error" }),
      ]);

      expect(state.failedTools).toBe(1);
    });

    /** @scenario Grok's tool decisions are counted in its own words */
    it("counts deny and followup as denied, cancelled as aborted, allow as neither", () => {
      const decision = (value: string) =>
        grokRecord({
          eventName: "grok_code.tool_decision",
          sessionId: PARENT,
          attributes: { tool_name: "run_terminal_command", decision: value, source: "user" },
        });
      const state = foldOne([
        ...turn(PARENT),
        decision("allow"),
        decision("deny"),
        decision("followup"),
        decision("cancelled"),
      ]);

      expect(state.toolsDenied).toBe(2);
      expect(state.toolsAborted).toBe(1);
    });

    /** @scenario A Grok MCP tool run names its server and tool on the row */
    it("reads the server from mcp_server_name and strips it off the tool name", () => {
      const state = foldOne([
        toolResult(PARENT, "github__search_repositories", { mcp_server_name: "github" }),
      ]);

      expect(state.mcpServers).toEqual(["github"]);
      expect(state.mcpTools).toEqual(["search_repositories"]);
    });
  });

  describe("given Grok's resource identity", () => {
    /** @scenario Grok's version and entrypoint reach the row */
    it("carries the agent version and the entrypoint", () => {
      const state = foldOne(turn(PARENT));

      expect(state.agentVersion).toBe("1.0.70 (f50904eaee6c)");
      expect(state.entrypoint).toBe("headless");
    });

    /** @scenario The row's opaque user id is Grok's, the email never is */
    it("keeps the opaque user id and never the email", () => {
      const state = foldOne(turn(PARENT));

      expect(state.userId).toBe(USER_ID);
      expect(JSON.stringify(state)).not.toContain(EMAIL);
    });

    /** @scenario The user's email Grok stamps on every record is never stored as a session field */
    it("stores no email on the row, though every record carries one", () => {
      const records = [...turn(PARENT), ...turn(PARENT)];

      expect(records.every((stored) => stored.attributesFlatJson.includes(EMAIL))).toBe(true);
      expect(JSON.stringify(foldOne(records))).not.toContain(EMAIL);
    });
  });

  describe("given a Grok session that spawned a subagent", () => {
    /** @scenario A Grok subagent's records fold into a row of its own */
    it("folds the subagent's calls onto its own row only", () => {
      const sessions = foldSessions([
        ...turn(PARENT),
        userPrompt(CHILD, "List the files in src."),
        apiRequest(CHILD, { input: 10_780, cacheRead: 0, output: 61, micros: 20_000 }),
      ]);

      expect(sessions.size).toBe(2);
      expect(sessions.get(PARENT)!.inputTokens).toBe(124);
      expect(sessions.get(CHILD)!.inputTokens).toBe(10_780);
      expect(sessions.get(CHILD)!.costUsd).toBeCloseTo(0.02);
    });

    /** @scenario The SubagentStart hook links the child row to its parent */
    it("links the child row to the parent from the hook's context record", () => {
      const sessions = foldSessions([
        contextRecord({ sessionId: CHILD, attributes: { parent_session_id: PARENT } }),
        userPrompt(CHILD, "List the files in src."),
      ]);

      expect(sessions.get(CHILD)!.parentSessionId).toBe(PARENT);
    });
  });

  describe("given the first prompt of a top-level Grok session", () => {
    /** @scenario A Grok session is titled from its first prompt without the query wrapper */
    it("titles the session from inside the user_query wrapper", () => {
      const state = foldOne([
        userPrompt(PARENT, "<user_query>\nAdd a subtract function.\n</user_query>"),
      ]);

      expect(state.title).toBe("Add a subtract function.");
    });
  });

  describe("given the context record the SessionStart hook posted", () => {
    /** @scenario A Grok session's git context comes from the hook record */
    it("carries the repository, branch and worktree", () => {
      const state = foldOne([
        contextRecord({
          sessionId: PARENT,
          attributes: {
            "vcs.repository.host": "github.com",
            "vcs.repository.owner": "acme",
            "vcs.repository.name": "widgets",
            "vcs.ref.head.name": "feat/grok",
            "vcs.worktree.name": "widgets",
          },
        }),
        ...turn(PARENT),
      ]);

      expect(state.repositoryName).toBe("widgets");
      expect(state.gitBranch).toBe("feat/grok");
      expect(state.gitWorktree).toBe("widgets");
    });
  });
});

describe("Grok model calls", () => {
  describe("given an api_request whose input includes its cache read", () => {
    /** @scenario A Grok api_request becomes one model call on its session */
    it("folds one call with the cache read taken out of the input", () => {
      const state = foldOne([apiRequest(PARENT, { input: 25_852, cacheRead: 25_728, output: 98 })]);

      expect(state.modelCalls).toBe(1);
      expect(state.models).toEqual(["grok-4.7"]);
      expect(state.inputTokens).toBe(124);
      expect(state.cacheReadTokens).toBe(25_728);
      expect(state.outputTokens).toBe(98);
    });

    /** @scenario Input is never counted again with the cache added on top */
    it("totals each call's stated input and output across four calls", () => {
      const calls = [
        { input: 25_852, cacheRead: 25_728, output: 98 },
        { input: 25_279, cacheRead: 1_152, output: 381 },
        { input: 26_010, cacheRead: 25_856, output: 140 },
        { input: 26_300, cacheRead: 26_112, output: 77 },
      ];
      const state = foldOne(calls.map((call) => apiRequest(PARENT, call)));

      const stated = calls.reduce((sum, call) => sum + call.input + call.output, 0);
      expect(state.inputTokens + state.cacheReadTokens + state.outputTokens).toBe(stated);
    });

    /** @scenario A Grok call with no cache read keeps its whole input as fresh */
    it("keeps the whole input when nothing was read from cache", () => {
      const state = foldOne([apiRequest(PARENT, { input: 10_780, cacheRead: 0, output: 61 })]);

      expect(state.inputTokens).toBe(10_780);
    });

    /** @scenario A cache read larger than the stated input never yields negative input */
    it("floors the fresh input at zero", () => {
      const state = foldOne([apiRequest(PARENT, { input: 100, cacheRead: 250, output: 5 })]);

      expect(state.inputTokens).toBe(0);
    });
  });

  describe("given Grok's micro-dollar cost", () => {
    /** @scenario cost_usd_micros becomes the reported cost in dollars */
    it("restates it in dollars", () => {
      const state = foldOne([
        apiRequest(PARENT, { input: 25_279, cacheRead: 1_152, output: 381, micros: 51_116 }),
      ]);

      expect(state.agentReportedCostUsd).toBeCloseTo(0.051116, 9);
    });

    /** @scenario The reported cost is the session cost */
    it("makes the sum of the reported costs the session cost, not the catalogue's", () => {
      const state = foldOne([
        apiRequest(PARENT, { input: 25_279, cacheRead: 1_152, output: 381, micros: 51_116 }),
        apiRequest(PARENT, { input: 25_852, cacheRead: 25_728, output: 98, micros: 9_884 }),
      ]);

      expect(state.costUsd).toBeCloseTo(0.061, 9);
      expect(state.agentReportedCostUsd).toBeCloseTo(0.061, 9);
    });

    /** @scenario grok_code.token.usage and grok_code.cost.usage do not add to the session's call totals */
    it("keeps the call totals at the api_request figures when the metrics describe the same calls", () => {
      const projection = makeProjection();
      const afterLogs = foldOne([
        apiRequest(PARENT, { input: 25_279, cacheRead: 1_152, output: 381, micros: 51_116 }),
      ]);
      const metric = (metricName: string, type: string | null, value: number) =>
        projection.handleCodingAgentSessionMetricFactsContributed(
          {
            id: `evt-${metricName}-${type}`,
            aggregateId: PARENT,
            aggregateType: "coding_agent_session",
            createdAt: 2_000,
            occurredAt: 2_000,
            version: "2025-01-01",
            tenantId: createTenantId("project-1"),
            type: METRIC_FACTS_CONTRIBUTED_EVENT_TYPE,
            data: {
              tenantId: "project-1",
              sessionId: PARENT,
              sessionKeySource: "provider",
              agent: "grok",
              occurredAt: 2_000,
              seriesId: `${metricName}-${type}`,
              metricName,
              unit: null,
              attributes: type !== null ? { type, model: "grok-4.7" } : { model: "grok-4.7" },
              value,
              dataPointCount: 1,
              asOfUnixMs: 2_000,
            },
          },
          afterLogs,
        );

      const afterInput = metric("grok_code.token.usage", "input", 25_279);
      const afterCost = metric("grok_code.cost.usage", null, 0.051116);

      for (const state of [afterInput, afterCost]) {
        expect(state.inputTokens).toBe(afterLogs.inputTokens);
        expect(state.outputTokens).toBe(afterLogs.outputTokens);
        expect(state.cacheReadTokens).toBe(afterLogs.cacheReadTokens);
        expect(state.costUsd).toBeCloseTo(afterLogs.costUsd, 9);
        expect(state.modelCalls).toBe(afterLogs.modelCalls);
      }
    });

    /** @scenario Each per-call row carries its own reported cost */
    it("writes the reported cost and the fresh input on the per-call row", () => {
      const projection = CodingAgentSessionEventsMapProjection.create({
        store: { append: async () => undefined, bulkAppend: async () => undefined },
        modelProviders: new TestModelProviderService(() => CATALOGUE_PRICE_USD),
      });
      const [event] = logEvents([
        apiRequest(PARENT, { input: 25_279, cacheRead: 1_152, output: 381, micros: 51_116 }),
      ]);

      const row = projection.mapCodingAgentSessionLogFactsContributed(event!);

      expect(row?.costUsd).toBeCloseTo(0.051116, 9);
      expect(row?.inputTokens).toBe(24_127);
      expect(row?.cacheReadTokens).toBe(1_152);
    });
  });
});
