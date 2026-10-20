/**
 * Copilot sessions lifted and folded as the pipeline does, from the canonical attributes of the
 * #8803 captures (CLI 1.0.100, Copilot Chat 0.67).
 * @see specs/coding-agent/copilot-sessions.feature
 */

import {
  genAiOperationRoleOf,
  isModelCallSpan,
  SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
  type SpanFactsContributedEvent,
} from "@langwatch/coding-agent-contract";
import { createTenantId, decodeFoldCacheEntry, encodeFoldCacheEntry } from "@langwatch/eventing";
import { NormalizedSpanKind, type NormalizedSpan } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TestModelProviderService } from "../../__tests__/fixtures/coding-agent-processing.fixture.ts";
import { ClaudeAnswersTraceCanonicalisation } from "../../__tests__/fixtures/trace-canonicalisation.fixture.ts";
import { liftSpanContribution } from "../../rules/coding-agent-span-facts.rules.ts";
import { isFoldedModelCall } from "../coding-agent-session-span.projection.ts";
import {
  CodingAgentSessionFoldProjection,
  type CodingAgentSessionState,
} from "../coding-agent-session.projection.ts";

const CLI_CONVERSATION = "00000000-0000-4000-8000-000000000001";
const VSCODE_CONVERSATION = "00000000-0000-4000-8000-000000000014";
/** The source type the ingest-key receiver stamps on the resource. */
const SOURCE = "langwatch.source";
const PRICE_PER_CALL_USD = 0.001;

interface CapturedSpan {
  name: string;
  scopeName: string;
  startMs: number;
  endMs: number;
  /** The ingest key's source type, as the receiver stamps it on the resource. */
  source: string;
  attributes: Record<string, unknown>;
}

function normalized({
  name,
  scopeName,
  startMs,
  endMs,
  source,
  attributes,
}: CapturedSpan): NormalizedSpan {
  return {
    id: `row-${name}-${startMs}`,
    traceId: "c0ffee00c0ffee00c0ffee00c0ffee00",
    spanId: `span-${startMs}`,
    tenantId: "project-1",
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: startMs,
    endTimeUnixMs: endMs,
    durationMs: endMs - startMs,
    name,
    kind: NormalizedSpanKind.INTERNAL,
    resourceAttributes: { [SOURCE]: source },
    spanAttributes: attributes,
    events: [],
    links: [],
    statusMessage: null,
    statusCode: null,
    instrumentationScope: { name: scopeName, version: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
  };
}

function lift(captured: CapturedSpan) {
  return liftSpanContribution({
    tenantId: "project-1",
    occurredAt: captured.startMs,
    span: normalized(captured),
  });
}

function makeProjection() {
  return CodingAgentSessionFoldProjection.create({
    store: { store: async () => {}, get: async () => ({ kind: "empty" as const }) },
    traceCanonicalisation: ClaudeAnswersTraceCanonicalisation.create(),
    modelProviders: new TestModelProviderService(() => PRICE_PER_CALL_USD),
  });
}

/** Lifts and folds the spans in order, keyed by the session each lands in. */
function foldSessions(
  spans: CapturedSpan[],
  initial?: CodingAgentSessionState,
): Map<string, CodingAgentSessionState> {
  const projection = makeProjection();
  const sessions = new Map<string, CodingAgentSessionState>();
  for (const captured of spans) {
    const lifted = lift(captured);
    if (lifted.outcome === "ignored") continue;
    const data = lifted.contribution;
    const event: SpanFactsContributedEvent = {
      id: `evt-${data.spanId}`,
      aggregateId: data.sessionId,
      aggregateType: "coding_agent_session",
      createdAt: data.occurredAt,
      occurredAt: data.occurredAt,
      version: "2025-01-01",
      tenantId: createTenantId(data.tenantId),
      type: SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
      data,
    };
    const state = sessions.get(data.sessionId) ?? initial ?? projection.init();
    sessions.set(
      data.sessionId,
      projection.handleCodingAgentSessionSpanFactsContributed(event, state),
    );
  }
  return sessions;
}

const cliRoot: CapturedSpan = {
  name: "invoke_agent",
  scopeName: "github.copilot",
  startMs: 1_000,
  endMs: 20_000,
  source: "copilot_cli",
  attributes: {
    "gen_ai.operation.name": "invoke_agent",
    "gen_ai.conversation.id": CLI_CONVERSATION,
    // The rollup of the two calls below, which the fold must not count again.
    "gen_ai.usage.input_tokens": 51325,
    "gen_ai.usage.output_tokens": 88,
    "metadata.copilot_nano_aiu": "253341500",
    "langwatch.reserved.skip_token_accumulation": "true",
  },
};

function cliChat({
  startMs,
  input,
  output,
  cacheCreation,
  cacheRead,
  nanoAiUnits,
}: {
  startMs: number;
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  nanoAiUnits: string;
}): CapturedSpan {
  return {
    name: "chat gpt-6-luna",
    scopeName: "github.copilot",
    startMs,
    endMs: startMs + 1_500,
    source: "copilot_cli",
    attributes: {
      "gen_ai.operation.name": "chat",
      "gen_ai.conversation.id": CLI_CONVERSATION,
      "gen_ai.request.model": "gpt-6-luna",
      "gen_ai.usage.input_tokens": input,
      "gen_ai.usage.output_tokens": output,
      "gen_ai.usage.cache_creation.input_tokens": cacheCreation,
      "gen_ai.usage.cache_read.input_tokens": cacheRead,
      "metadata.copilot_cost": "1",
      "metadata.copilot_nano_aiu": nanoAiUnits,
    },
  };
}

function cliTool({ name, startMs }: { name: string; startMs: number }): CapturedSpan {
  return {
    name: `execute_tool ${name}`,
    scopeName: "github.copilot",
    startMs,
    endMs: startMs + 200,
    source: "copilot_cli",
    attributes: {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.conversation.id": CLI_CONVERSATION,
      "gen_ai.tool.name": name,
    },
  };
}

const firstCall = cliChat({
  startMs: 2_000,
  input: 3,
  output: 38,
  cacheCreation: 17039,
  cacheRead: 0,
  nanoAiUnits: "214917500",
});
const secondCall = cliChat({
  startMs: 6_000,
  input: 13,
  output: 50,
  cacheCreation: 0,
  cacheRead: 17039,
  nanoAiUnits: "38424000",
});
const cliSession = [
  firstCall,
  cliTool({ name: "rg", startMs: 4_000 }),
  cliTool({ name: "view", startMs: 4_400 }),
  secondCall,
  cliTool({ name: "rg", startMs: 7_600 }),
  // The root ends last, so it arrives last, as captured.
  cliRoot,
];

const vscodeChat: CapturedSpan = {
  name: "chat gpt-6-luna",
  scopeName: "copilot-chat",
  startMs: 1_000,
  endMs: 3_610,
  source: "copilot_vscode",
  attributes: {
    "gen_ai.operation.name": "chat",
    "gen_ai.conversation.id": VSCODE_CONVERSATION,
    "gen_ai.request.model": "gpt-6-luna",
    "gen_ai.agent.name": "panel/editAgent",
    "gen_ai.usage.input_tokens": 24441,
    "gen_ai.usage.output_tokens": 87,
    "gen_ai.usage.cache_read.input_tokens": 0,
    "metadata.copilot_nano_aiu": "309855000",
  },
};

describe("Copilot session fold", () => {
  describe("given the spans of one Copilot CLI conversation", () => {
    describe("when they are folded", () => {
      const sessions = foldSessions(cliSession);
      const row = sessions.get(CLI_CONVERSATION);

      /** @scenario A Copilot CLI session becomes one row with model, tokens and AI units */
      it("lands every span in one session keyed by the conversation id", () => {
        expect([...sessions.keys()]).toEqual([CLI_CONVERSATION]);
        expect(row?.sessionKeySource).toBe("provider");
        expect(row?.agent).toBe("copilot");
      });

      /** @scenario A Copilot CLI session becomes one row with model, tokens and AI units */
      it("shows the model, the token counts and the AI units", () => {
        expect(row?.models).toEqual(["gpt-6-luna"]);
        expect(row?.modelCalls).toBe(2);
        expect(row?.inputTokens).toBe(16);
        expect(row?.outputTokens).toBe(88);
        expect(row?.cacheCreationTokens).toBe(17039);
        expect(row?.cacheReadTokens).toBe(17039);
        expect(row?.aiUnits).toBeCloseTo(0.2533415, 9);
      });

      /** @scenario Tokens and AI units are counted from model calls, never again from the session root */
      it("counts the root's rollup nowhere, so the totals equal the two calls", () => {
        const callsOnly = foldSessions([firstCall, secondCall]).get(CLI_CONVERSATION);
        expect(row?.inputTokens).toBe(callsOnly?.inputTokens);
        expect(row?.outputTokens).toBe(callsOnly?.outputTokens);
        expect(row?.aiUnits).toBe(callsOnly?.aiUnits);
      });

      /** @scenario A Copilot CLI session becomes one row with model, tokens and AI units */
      it("keeps the AI units out of both dollar figures", () => {
        expect(row?.costUsd).toBeCloseTo(2 * PRICE_PER_CALL_USD, 9);
        expect(row?.agentReportedCostUsd).toBe(0);
      });

      /** @scenario The session root sets the row's start */
      it("starts the row when the root started, though the root arrived last", () => {
        expect(row?.startedAtMs).toBe(cliRoot.startMs);
      });

      /** @scenario Tool runs are counted with their names */
      it("counts three tool runs under their names", () => {
        expect(row?.toolCalls).toBe(3);
        expect(row?.toolCounts).toEqual({ rg: 2, view: 1 });
      });
    });

    describe("when they fold onto a state cached before the AI units column", () => {
      const { aiUnits: _addedLater, ...beforeColumn } = makeProjection().init();
      const cached = decodeFoldCacheEntry<CodingAgentSessionState>(
        encodeFoldCacheEntry({ state: beforeColumn, updatedAt: 1, appliedEventIds: [] }),
      ).state;

      /** @scenario A Copilot CLI session becomes one row with model, tokens and AI units */
      it("sums the AI units from zero, never to NaN", () => {
        const row = foldSessions(cliSession, cached).get(CLI_CONVERSATION);
        expect(row?.aiUnits).toBeCloseTo(0.2533415, 9);
      });
    });
  });

  describe("given a VS Code title call, which carries no conversation id", () => {
    const titleCall: CapturedSpan = {
      name: "chat gpt-4o-mini-2024-07-18",
      scopeName: "copilot-chat",
      startMs: 1_000,
      endMs: 1_400,
      source: "copilot_vscode",
      attributes: {
        "gen_ai.operation.name": "chat",
        "gen_ai.agent.name": "title",
        "gen_ai.usage.input_tokens": 120,
        "gen_ai.usage.output_tokens": 6,
      },
    };

    describe("when it is lifted and folded", () => {
      /** @scenario A Copilot span without a conversation id mints no row */
      it("contributes nothing, rather than a session keyed by its trace", () => {
        expect(lift(titleCall).outcome).toBe("ignored");
        expect(foldSessions([titleCall]).size).toBe(0);
      });
    });
  });

  describe("given a captured Copilot chat span", () => {
    /** @scenario Copilot model calls are model calls everywhere */
    it("is stamped as a model call", () => {
      expect(isFoldedModelCall({ name: vscodeChat.name, agent: "copilot" })).toBe(true);
    });

    /** @scenario Copilot model calls are model calls everywhere */
    it("is folded as a model call", () => {
      expect(foldSessions([vscodeChat]).get(VSCODE_CONVERSATION)?.modelCalls).toBe(1);
    });

    /** @scenario Copilot model calls are model calls everywhere */
    it("is shown as a model call in the trace browser", () => {
      expect(isModelCallSpan(vscodeChat.name)).toBe(true);
    });
  });

  describe("given one Copilot session from the CLI and one from VS Code", () => {
    describe("when the rows are folded", () => {
      const sessions = foldSessions([...cliSession, vscodeChat]);

      /** @scenario The row shows the surface it ran in */
      it("labels both rows copilot and shows each one's surface", () => {
        expect(sessions.get(CLI_CONVERSATION)?.agent).toBe("copilot");
        expect(sessions.get(VSCODE_CONVERSATION)?.agent).toBe("copilot");
        expect(sessions.get(CLI_CONVERSATION)?.entrypoint).toBe("cli");
        expect(sessions.get(VSCODE_CONVERSATION)?.entrypoint).toBe("vscode");
      });

      /** @scenario The row shows the surface it ran in */
      it("reads VS Code's AI units off its chat span, as the CLI's", () => {
        expect(sessions.get(VSCODE_CONVERSATION)?.aiUnits).toBeCloseTo(0.309855, 9);
      });
    });
  });

  describe("given Claude Code and Codex spans carrying what the Copilot declarations read", () => {
    // An AI-unit count and, for codex, a chat span with no session key: each changes a Copilot
    // row, and neither may change theirs.
    const claudeCall: CapturedSpan = {
      name: "claude_code.llm_request",
      scopeName: "com.anthropic.claude_code",
      startMs: 1_000,
      endMs: 2_000,
      source: "claude_code",
      attributes: { "session.id": "claude-session", "metadata.copilot_nano_aiu": "214917500" },
    };
    const keylessCodexChat: CapturedSpan = {
      name: "chat gpt-5.6-sol",
      scopeName: "codex_otel",
      startMs: 1_000,
      endMs: 2_000,
      source: "codex",
      attributes: { "gen_ai.operation.name": "chat", "metadata.copilot_nano_aiu": "38424000" },
    };

    describe("when their rows are folded", () => {
      const sessions = foldSessions([claudeCall, keylessCodexChat]);
      const claudeRow = sessions.get("claude-session");
      const codexRow = [...sessions.values()].find((row) => row.agent === "codex");

      /** @scenario Claude Code and Codex rows are unchanged by the Copilot declarations */
      it("counts no AI units on either row", () => {
        expect(claudeRow?.agent).toBe("claude_code");
        expect(claudeRow?.aiUnits).toBe(0);
        expect(codexRow?.aiUnits).toBe(0);
      });

      /** @scenario Claude Code and Codex rows are unchanged by the Copilot declarations */
      it("still keys the keyless codex span by its trace, rather than dropping it", () => {
        expect(codexRow?.sessionKeySource).toBe("trace_fallback");
      });

      /** @scenario Claude Code and Codex rows are unchanged by the Copilot declarations */
      it("does not fold the codex chat span as a Copilot model call", () => {
        expect(genAiOperationRoleOf({ agent: "codex", name: keylessCodexChat.name })).toBe(
          "undeclared",
        );
      });
    });
  });
});
