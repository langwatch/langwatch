/**
 * pi sessions lifted and folded as the pipeline does, from the canonical attributes a pi span
 * leaves ingestion with: the GenAI keys pi dual-writes, its cache counts moved onto the GenAI
 * names by the pi canonicaliser, and pi's own keys beside them (ADR-188).
 * @see specs/coding-agent/pi-sessions.feature
 * @see specs/coding-agent/pi-model-calls.feature
 */

import {
  admitsCodingAgentSpan,
  buildCodingAgentTranscript,
  detectCodingAgent,
  isModelCallSpan,
  LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
  type LogFactsContributedEvent,
  SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
  type SpanFactsContributedEvent,
} from "@langwatch/coding-agent-contract";
import { createTenantId } from "@langwatch/eventing";
import type { CanonicalLogRecord } from "@langwatch/log-contract";
import {
  NormalizedSpanKind,
  type NormalizedSpan,
  type SpanDetail,
} from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { TestModelProviderService } from "../../__tests__/fixtures/coding-agent-processing.fixture.ts";
import { TestGithubService } from "../../__tests__/fixtures/coding-agent.fixture.ts";
import { ClaudeAnswersTraceCanonicalisation } from "../../__tests__/fixtures/trace-canonicalisation.fixture.ts";
import { CodingAgentPullRequestAssignmentService } from "../../features/pull-requests/services/coding-agent-pull-request-assignment.service.ts";
import { CodingAgentPullRequestUsageService } from "../../features/pull-requests/services/coding-agent-pull-request-usage.service.ts";
import { liftLogContribution } from "../../rules/coding-agent-log-facts.rules.ts";
import { toCodingAgentSessionRow } from "../../rules/coding-agent-session-row-mapper.rules.ts";
import { liftSpanContribution } from "../../rules/coding-agent-span-facts.rules.ts";
import {
  type CodingAgentSessionEventRecord,
  CodingAgentSessionEventsMapProjection,
} from "../coding-agent-session-events.projection.ts";
import { isFoldedModelCall } from "../coding-agent-session-span.projection.ts";
import {
  CodingAgentSessionFoldProjection,
  type CodingAgentSessionState,
} from "../coding-agent-session.projection.ts";
import {
  createPullRequestMappingHandler,
  shouldMapPullRequests,
} from "../pull-request-mapping.subscriber.ts";

const SESSION = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const OTHER_SESSION = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
/** The source type the ingest-key receiver stamps on the resource. */
const SOURCE = "langwatch.source";
/** pi's scope is its package name; detection reads the span name regardless. */
const PI_SCOPE = "@earendil-works/pi-agent-core";
const MODEL = "claude-opus-4-7";
const CATALOGUE_PRICE_PER_CALL_USD = 0.002;

interface CapturedSpan {
  name: string;
  scopeName?: string;
  serviceName?: string;
  startMs: number;
  endMs: number;
  statusCode?: number;
  attributes: Record<string, unknown>;
}

function normalized({
  name,
  scopeName = PI_SCOPE,
  serviceName,
  startMs,
  endMs,
  statusCode,
  attributes,
}: CapturedSpan): NormalizedSpan {
  return {
    id: `row-${name}-${startMs}`,
    traceId: "c0ffee00c0ffee00c0ffee00c0ffee00",
    spanId: `span-${name}-${startMs}`,
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
    resourceAttributes: {
      [SOURCE]: "pi_cli",
      ...(serviceName !== undefined ? { "service.name": serviceName } : {}),
    },
    spanAttributes: attributes,
    events: [],
    links: [],
    statusMessage: null,
    statusCode: statusCode ?? null,
    instrumentationScope: { name: scopeName, version: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
  };
}

/** What the pipeline's dispatch filter decides before any job is minted for the span. */
function admitted({ name, scopeName = PI_SCOPE }: CapturedSpan): boolean {
  return admitsCodingAgentSpan({ name, scopeName });
}

function lift(captured: CapturedSpan) {
  return liftSpanContribution({
    tenantId: "project-1",
    occurredAt: captured.startMs,
    span: normalized(captured),
  });
}

function makeProjection(
  modelProviders = new TestModelProviderService(() => CATALOGUE_PRICE_PER_CALL_USD),
) {
  return CodingAgentSessionFoldProjection.create({
    store: { store: async () => {}, get: async () => ({ kind: "empty" as const }) },
    traceCanonicalisation: ClaudeAnswersTraceCanonicalisation.create(),
    modelProviders,
  });
}

/** The contribution events the admitted spans lift to, in order. */
function spanEvents(spans: CapturedSpan[]): SpanFactsContributedEvent[] {
  return spans.filter(admitted).flatMap((captured) => {
    const lifted = lift(captured);
    if (lifted.outcome === "ignored") return [];
    const data = lifted.contribution;
    return [
      {
        id: `evt-${data.spanId}`,
        aggregateId: data.sessionId,
        aggregateType: "coding_agent_session",
        createdAt: data.occurredAt,
        occurredAt: data.occurredAt,
        version: "2025-01-01",
        tenantId: createTenantId(data.tenantId),
        type: SPAN_FACTS_CONTRIBUTED_EVENT_TYPE,
        data,
      },
    ];
  });
}

/** The per-call fact rows the spans write, as the pipeline's map projection writes them. */
function perCallRows(
  spans: CapturedSpan[],
  modelProviders = new TestModelProviderService(() => CATALOGUE_PRICE_PER_CALL_USD),
): CodingAgentSessionEventRecord[] {
  const projection = CodingAgentSessionEventsMapProjection.create({
    store: { append: async () => undefined, bulkAppend: async () => undefined },
    modelProviders,
  });
  return spanEvents(spans).flatMap(
    (event) => projection.mapCodingAgentSessionSpanFactsContributed(event) ?? [],
  );
}

/** Lifts and folds the admitted spans in order, keyed by the session each lands in. */
function foldSessions(
  spans: CapturedSpan[],
  initial?: CodingAgentSessionState,
  projection = makeProjection(),
): Map<string, CodingAgentSessionState> {
  const sessions = new Map<string, CodingAgentSessionState>();
  for (const event of spanEvents(spans)) {
    const data = event.data;
    const state = sessions.get(data.sessionId) ?? initial ?? projection.init();
    sessions.set(
      data.sessionId,
      projection.handleCodingAgentSessionSpanFactsContributed(event, state),
    );
  }
  return sessions;
}

/** One checkout a session context record names, as the CLI's hook reads it from git. */
interface DeclaredCheckout {
  host: string;
  owner: string;
  name: string;
  branch: string;
}

/** The record `langwatch ingest hook pi` posts, as stored: CLI scope and service, pi's id. */
function sessionContextRecord({
  sessionId,
  checkout,
  timeMs,
}: {
  sessionId: string;
  checkout: DeclaredCheckout;
  timeMs: number;
}): CanonicalLogRecord {
  const attributes = {
    "event.name": "langwatch.session_context",
    "session.id": sessionId,
    "coding_agent.name": "pi",
    "vcs.repository.host": checkout.host,
    "vcs.repository.owner": checkout.owner,
    "vcs.repository.name": checkout.name,
    "vcs.ref.head.name": checkout.branch,
  };
  return {
    tenantId: "project-1",
    organizationId: "organization-1",
    recordId: `${timeMs}`.padStart(64, "0"),
    resourceSchemaUrl: "",
    resourceAttributesJson: "[]",
    resourceAttributesFlatJson: JSON.stringify({ "service.name": "langwatch-cli" }),
    resourceAttributeKeys: ["service.name"],
    resourceDroppedAttributesCount: 0,
    scopeSchemaUrl: "",
    scopeName: "langwatch.coding_agent.hook",
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
    eventName: "langwatch.session_context",
    providerKind: "generic",
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

/** Lifts each record as log processing does and folds it onto the session it keys. */
function foldContextRecords(
  records: CanonicalLogRecord[],
  sessions = new Map<string, CodingAgentSessionState>(),
): Map<string, CodingAgentSessionState> {
  const projection = makeProjection();
  for (const record of records) {
    const lifted = liftLogContribution({
      record,
      traces: ClaudeAnswersTraceCanonicalisation.create(),
    });
    if (lifted.outcome === "ignored") continue;
    const data = lifted.contribution;
    const event: LogFactsContributedEvent = {
      id: `evt-${data.recordId}`,
      aggregateId: data.sessionId,
      aggregateType: "coding_agent_session",
      createdAt: data.occurredAt,
      occurredAt: data.occurredAt,
      version: "2025-01-01",
      tenantId: createTenantId(data.tenantId),
      type: LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
      data,
    };
    const state = sessions.get(data.sessionId) ?? projection.init();
    sessions.set(
      data.sessionId,
      projection.handleCodingAgentSessionLogFactsContributed(event, state),
    );
  }
  return sessions;
}

const WIDGETS: DeclaredCheckout = {
  host: "github.com",
  owner: "acme",
  name: "widgets",
  branch: "feat/pi-sessions",
};

function piRun({
  sessionId = SESSION,
  startMs = 1_000,
  attributes = {},
}: {
  sessionId?: string;
  startMs?: number;
  attributes?: Record<string, unknown>;
} = {}): CapturedSpan {
  return {
    name: "pi.harness.run",
    startMs,
    endMs: startMs + 20_000,
    attributes: {
      "pi.session.id": sessionId,
      "pi.operation.kind": "run",
      "pi.operation.outcome": "completed",
      ...attributes,
    },
  };
}

function piTurn({
  sessionId = SESSION,
  startMs,
}: {
  sessionId?: string;
  startMs: number;
}): CapturedSpan {
  return {
    name: "pi.harness.turn",
    startMs,
    endMs: startMs + 4_000,
    attributes: { "pi.session.id": sessionId, "pi.turn.id": String(startMs) },
  };
}

function piCall({
  sessionId = SESSION,
  startMs,
  input,
  output,
  cacheRead = 0,
  cacheWrite = 0,
  reportedCostUsd,
  model = MODEL,
}: {
  sessionId?: string;
  startMs: number;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  reportedCostUsd?: number;
  model?: string;
}): CapturedSpan {
  return {
    name: "pi.ai.request",
    startMs,
    endMs: startMs + 1_500,
    attributes: {
      "pi.session.id": sessionId,
      "pi.ai.provider": "anthropic",
      "pi.ai.model": model,
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": model,
      "gen_ai.response.model": model,
      "gen_ai.usage.input_tokens": input,
      "gen_ai.usage.output_tokens": output,
      "gen_ai.usage.cache_read.input_tokens": cacheRead,
      "gen_ai.usage.cache_creation.input_tokens": cacheWrite,
      "pi.ai.usage.input_tokens": input,
      "pi.ai.usage.output_tokens": output,
      "pi.ai.usage.total_tokens": input + output + cacheRead + cacheWrite,
      ...(reportedCostUsd !== undefined ? { "pi.ai.usage.cost": reportedCostUsd } : {}),
    },
  };
}

function piTool({
  sessionId = SESSION,
  name,
  startMs,
}: {
  sessionId?: string;
  name: string;
  startMs: number;
}): CapturedSpan {
  return {
    name: "pi.harness.tool",
    startMs,
    endMs: startMs + 200,
    attributes: {
      "pi.session.id": sessionId,
      "pi.tool.name": name,
      "pi.tool.call_id": `call-${startMs}`,
      "pi.tool.is_error": false,
      // The pi canonicaliser copies pi's tool name onto the GenAI key the fold reads.
      "gen_ai.tool.name": name,
    },
  };
}

const firstCall = piCall({
  startMs: 2_000,
  input: 120,
  output: 30,
  cacheWrite: 9_000,
  reportedCostUsd: 0.0875,
});
const secondCall = piCall({
  startMs: 7_000,
  input: 40,
  output: 60,
  cacheRead: 9_000,
  reportedCostUsd: 0.0125,
});
const piSession = [
  piTurn({ startMs: 1_500 }),
  firstCall,
  piTool({ name: "read", startMs: 4_000 }),
  piTool({ name: "read", startMs: 4_400 }),
  piTool({ name: "bash", startMs: 5_000 }),
  secondCall,
  // The run ends last, so it arrives last, after its turns.
  piRun({ attributes: { "gen_ai.usage.input_tokens": 160, "gen_ai.usage.output_tokens": 90 } }),
];

describe("pi session admission", () => {
  describe("given the run, turn and tool spans of one pi session", () => {
    /** @scenario "A span in pi's namespace is admitted as a pi session span" */
    it("admits each, and detects each as pi", () => {
      const spans = [piRun(), piTurn({ startMs: 1_500 }), piTool({ name: "read", startMs: 4_000 })];

      expect(spans.map(admitted)).toEqual([true, true, true]);
      expect(spans.map((span) => detectCodingAgent({ recordName: span.name }))).toEqual([
        "pi",
        "pi",
        "pi",
      ]);
    });
  });

  describe("given a copilot span whose service name is copilot-cli", () => {
    /** @scenario "A copilot span is never claimed by pi" */
    it("detects it as copilot and not as pi", () => {
      const lifted = lift({
        name: "chat gpt-6-luna",
        scopeName: "github.copilot",
        serviceName: "copilot-cli",
        startMs: 1_000,
        endMs: 2_000,
        attributes: { "gen_ai.conversation.id": SESSION },
      });

      expect(lifted.outcome === "contributes" && lifted.contribution.agent).toBe("copilot");
    });
  });

  describe("given spans whose service or scope merely contains pi's two letters", () => {
    /** @scenario "A span whose scope or service merely contains pi's two letters is not pi's" */
    it("detects neither as pi", () => {
      const byService = detectCodingAgent({
        recordName: "request",
        scopeName: "com.acme.tracing",
        serviceName: "anthropic",
      });
      const byScope = detectCodingAgent({
        recordName: "request",
        scopeName: "com.acme.api",
        serviceName: null,
      });

      expect(byService).not.toBe("pi");
      expect(byScope).not.toBe("pi");
    });
  });

  describe("given a span in pi's namespace whose name pi does not declare", () => {
    /** @scenario "A pi span of an undeclared name is not admitted" */
    it("is not admitted", () => {
      expect(admitted({ ...piTurn({ startMs: 1_500 }), name: "pi.internal.gossip" })).toBe(false);
    });
  });

  describe("given the compaction, step and navigation spans the extension emits", () => {
    const harness: CapturedSpan[] = [
      "pi.harness.compaction",
      "pi.harness.step",
      "pi.harness.navigation",
    ].map((name, index) => ({ ...piTurn({ startMs: 8_000 + index * 100 }), name }));

    /** @scenario "The compaction, step and navigation spans the extension emits join the pi session" */
    it("admits each, and folds each onto the session's one row", () => {
      expect(harness.map(admitted)).toEqual([true, true, true]);
      expect(spanEvents(harness).map((event) => event.data.sessionId)).toEqual([
        SESSION,
        SESSION,
        SESSION,
      ]);
      expect([...foldSessions([...piSession, ...harness]).keys()]).toEqual([SESSION]);
    });
  });

  describe("given a harness span pi declares that the definition does not list", () => {
    const checkpoint: CapturedSpan = {
      ...piTurn({ startMs: 3_000 }),
      name: "pi.harness.checkpoint",
    };

    /** @scenario "A harness span pi declares but we do not list is dropped with nothing recorded" */
    it("is not admitted, and the session row is what it would be without it", () => {
      expect(admitted(checkpoint)).toBe(false);
      expect(foldSessions([...piSession, checkpoint]).get(SESSION)).toEqual(
        foldSessions(piSession).get(SESSION),
      );
    });
  });
});

describe("pi session fold", () => {
  describe("given the spans of one pi session whose run carries pi.session.id", () => {
    describe("when they are folded", () => {
      const sessions = foldSessions(piSession);
      const row = sessions.get(SESSION);

      /** @scenario "A pi session becomes one row keyed by pi's session id" */
      it("lands every span in one row keyed by that session id", () => {
        expect([...sessions.keys()]).toEqual([SESSION]);
        expect(row?.sessionKeySource).toBe("provider");
        expect(row?.agent).toBe("pi");
      });

      /** @scenario "A pi session becomes one row keyed by pi's session id" */
      it("shows the model and the input and output tokens", () => {
        expect(row?.models).toEqual([MODEL]);
        expect(row?.inputTokens).toBe(160);
        expect(row?.outputTokens).toBe(90);
      });

      /** @scenario "Tokens are counted from the model calls, never again from the run" */
      it("counts the run's rollup nowhere, so the tokens equal the two calls", () => {
        const callsOnly = foldSessions([firstCall, secondCall]).get(SESSION);
        expect(row?.modelCalls).toBe(2);
        expect(row?.inputTokens).toBe(callsOnly?.inputTokens);
        expect(row?.outputTokens).toBe(callsOnly?.outputTokens);
      });

      /** @scenario "Tool runs are counted under pi's own tool names" */
      it("counts the tool runs under pi's tool names", () => {
        expect(row?.toolCounts).toEqual({ read: 2, bash: 1 });
        expect(row?.toolCalls).toBe(3);
      });

      /** @scenario "The run sets the row's start, whatever the arrival order" */
      it("starts the row when the run started, though the run arrived after its turns", () => {
        expect(row?.startedAtMs).toBe(1_000);
      });

      /** @scenario "A pi session falls back to untitled rather than to a span name" */
      it("leaves the row untitled, since pi declares no prompt or title attribute", () => {
        expect(row?.title ?? null).toBeNull();
      });
    });
  });

  describe("given the spans of two pi sessions interleaved in arrival order", () => {
    /** @scenario "Two concurrent pi sessions fold into two rows" */
    it("folds them into two rows, one per session id", () => {
      const sessions = foldSessions([
        piCall({ startMs: 2_000, input: 10, output: 1 }),
        piCall({ sessionId: OTHER_SESSION, startMs: 2_100, input: 20, output: 2 }),
        piRun(),
        piRun({ sessionId: OTHER_SESSION, startMs: 1_100 }),
      ]);

      expect([...sessions.keys()].toSorted()).toEqual([SESSION, OTHER_SESSION].toSorted());
      expect(sessions.get(SESSION)?.inputTokens).toBe(10);
      expect(sessions.get(OTHER_SESSION)?.inputTokens).toBe(20);
    });
  });

  describe("given a pi.harness.turn carrying no session id and no admitted run", () => {
    /** @scenario "A pi span with no resolvable session mints no row" */
    it("contributes nothing, rather than a session keyed by its trace", () => {
      const keyless: CapturedSpan = {
        name: "pi.harness.turn",
        startMs: 1_000,
        endMs: 2_000,
        attributes: { "pi.turn.id": "0" },
      };

      expect(lift(keyless).outcome).toBe("ignored");
      expect(foldSessions([keyless]).size).toBe(0);
    });
  });
});

describe("pi model calls", () => {
  describe("given a pi.ai.request span carrying the dual-written GenAI attributes", () => {
    /** @scenario "A pi.ai.request span is recognised as a model call" */
    it("is stamped as a model call", () => {
      expect(isFoldedModelCall({ name: "pi.ai.request", agent: "pi" })).toBe(true);
    });

    /** @scenario "A pi.ai.request span is recognised as a model call" */
    it("is folded as a model call", () => {
      expect(foldSessions([firstCall]).get(SESSION)?.modelCalls).toBe(1);
    });

    /** @scenario "A pi.ai.request span is recognised as a model call" */
    it("is shown as a model call in the trace browser", () => {
      expect(isModelCallSpan("pi.ai.request")).toBe(true);
    });
  });

  describe("given a pi session with two model calls", () => {
    describe("when they are folded", () => {
      const rows = perCallRows(piSession);

      /** @scenario "Each model call writes one per-call row under its session" */
      it("writes two per-call rows under that session, each with its own figures", () => {
        expect(
          rows.map(({ sessionId, eventKind, model, inputTokens, outputTokens, costUsd }) => ({
            sessionId,
            eventKind,
            model,
            inputTokens,
            outputTokens,
            costUsd,
          })),
        ).toEqual([
          {
            sessionId: SESSION,
            eventKind: "model_call",
            model: MODEL,
            inputTokens: 120,
            outputTokens: 30,
            costUsd: CATALOGUE_PRICE_PER_CALL_USD,
          },
          {
            sessionId: SESSION,
            eventKind: "model_call",
            model: MODEL,
            inputTokens: 40,
            outputTokens: 60,
            costUsd: CATALOGUE_PRICE_PER_CALL_USD,
          },
        ]);
      });

      /** @scenario "Cache read and cache write tokens are kept apart" */
      it("records cache reads and cache writes as two counts", () => {
        expect(
          rows.map(({ cacheReadTokens, cacheCreationTokens }) => [
            cacheReadTokens,
            cacheCreationTokens,
          ]),
        ).toEqual([
          [0, 9_000],
          [9_000, 0],
        ]);
        const row = foldSessions(piSession).get(SESSION);
        expect(row?.cacheReadTokens).toBe(9_000);
        expect(row?.cacheCreationTokens).toBe(9_000);
      });

      /** @scenario "The session cost is the sum of its per-call charges" */
      it("charges the session the sum of its per-call costs", () => {
        expect(foldSessions(piSession).get(SESSION)?.costUsd).toBeCloseTo(
          rows.reduce((sum, each) => sum + each.costUsd, 0),
          9,
        );
      });

      /** @scenario "pi sells no unit of its own, so no AI units are claimed from its spans" */
      it("claims no AI units from any call", () => {
        expect(rows.map((each) => each.aiUnits)).toEqual([0, 0]);
      });
    });
  });

  describe("given a pi.ai.request span reporting only a total token count", () => {
    /** @scenario "A call that reports a total but no breakdown is not double counted" */
    it("counts the per-type figures only, never the total on top of them", () => {
      const totalOnly: CapturedSpan = {
        name: "pi.ai.request",
        startMs: 2_000,
        endMs: 3_000,
        attributes: {
          "pi.session.id": SESSION,
          "gen_ai.request.model": MODEL,
          "pi.ai.usage.total_tokens": 500,
        },
      };

      const totalOnlyRow = foldSessions([totalOnly]).get(SESSION);
      expect((totalOnlyRow?.inputTokens ?? 0) + (totalOnlyRow?.outputTokens ?? 0)).toBe(0);
      const withBreakdown = foldSessions([firstCall]).get(SESSION);
      expect(withBreakdown?.inputTokens).toBe(120);
      expect(withBreakdown?.outputTokens).toBe(30);
    });
  });

  describe("given pi.ai.request spans whose reported cost differs from the catalogue price", () => {
    describe("when the session is folded", () => {
      const row = foldSessions(piSession).get(SESSION);

      /** @scenario "A call is charged the catalogue price of its tokens, not pi's figure" */
      it("charges the catalogue price, whatever pi reported", () => {
        const unreported = foldSessions(
          piSession.map((span) =>
            span.name === "pi.ai.request"
              ? { ...span, attributes: { ...span.attributes, "pi.ai.usage.cost": 0 } }
              : span,
          ),
        ).get(SESSION);
        expect(row?.costUsd).toBeCloseTo(2 * CATALOGUE_PRICE_PER_CALL_USD, 9);
        expect(unreported?.costUsd).toBe(row?.costUsd);
      });

      /** @scenario "pi's reported cost accumulates on the session as a figure of its own" */
      it("accumulates pi's two reported amounts beside the catalogue cost", () => {
        expect(row?.agentReportedCostUsd).toBeCloseTo(0.0875 + 0.0125, 9);
        expect(row?.costUsd).toBeCloseTo(2 * CATALOGUE_PRICE_PER_CALL_USD, 9);
      });

      /** @scenario "The two figures disagreeing is readable, not reconciled away" */
      it("stores both figures on the session row, side by side", () => {
        const stored = toCodingAgentSessionRow({
          state: row!,
          tenantId: "project-1",
          sessionId: SESSION,
          version: "2025-01-01",
        });
        expect(stored.costUsd).toBeCloseTo(2 * CATALOGUE_PRICE_PER_CALL_USD, 9);
        expect(stored.agentReportedCostUsd).toBeCloseTo(0.1, 9);
      });
    });
  });

  describe("given a pi.ai.request span costed by pi for a model the catalogue does not price", () => {
    const UNPRICED_MODEL = "pi-local-model";
    const modelProviders = new TestModelProviderService(
      (input) => (input.model === UNPRICED_MODEL ? 0 : CATALOGUE_PRICE_PER_CALL_USD),
      (model) => model !== UNPRICED_MODEL,
    );
    const unpriced = piCall({
      startMs: 2_000,
      input: 50,
      output: 5,
      reportedCostUsd: 0.04,
      model: UNPRICED_MODEL,
    });

    /** @scenario "A model the catalogue does not price is recorded as unpriced, whatever pi costed it" */
    it("reads the call as unpriced and still accumulates pi's amount on the session", () => {
      const usage = CodingAgentPullRequestUsageService.create({ modelProviders });
      const row = foldSessions([unpriced], undefined, makeProjection(modelProviders)).get(SESSION);

      // The read side turns a span-fed call on an unpriced model into a null cost, not zero.
      expect(usage.isPricedAs({ agent: "pi", model: UNPRICED_MODEL })).toBe(false);
      expect(usage.isPricedAs({ agent: "pi", model: MODEL })).toBe(true);
      expect(perCallRows([unpriced], modelProviders).map((each) => each.costUsd)).toEqual([0]);
      expect(row?.costUsd).toBe(0);
      expect(row?.agentReportedCostUsd).toBeCloseTo(0.04, 9);
    });
  });
});

describe("pi session transcript", () => {
  /** A stored span as the trace read hands it over: dotted keys nested by their dots. */
  function spanDetail(fields: Partial<SpanDetail> & { name: string; startTimeMs: number }) {
    return {
      spanId: `span-${fields.name}-${fields.startTimeMs}`,
      parentSpanId: null,
      type: "span",
      endTimeMs: fields.startTimeMs + 1_000,
      durationMs: 1_000,
      status: "ok",
      events: [],
      ...fields,
    } satisfies SpanDetail;
  }

  describe("given a pi session whose model calls are pi.ai.request spans", () => {
    const transcript = buildCodingAgentTranscript({
      spans: [
        spanDetail({
          name: "pi.harness.run",
          startTimeMs: 0,
          params: { pi: { session: { id: SESSION } } },
        }),
        spanDetail({
          name: "pi.ai.request",
          startTimeMs: 200,
          params: {
            gen_ai: { request: { model: MODEL }, usage: { input_tokens: 120, output_tokens: 30 } },
          },
        }),
        spanDetail({
          name: "pi.ai.request",
          startTimeMs: 5_000,
          params: {
            gen_ai: { request: { model: MODEL }, usage: { input_tokens: 40, output_tokens: 60 } },
          },
        }),
      ],
      logs: [],
    });

    /** @scenario "A pi model call is shown as a model call, not as a tool run" */
    it("shows each model call once with the tokens it used, and none among the tool runs", () => {
      expect(
        transcript.entries
          .filter((entry) => entry.kind === "model_call")
          .map((entry) => ("tokens" in entry ? entry.tokens : null)),
      ).toEqual([150, 100]);
      expect(transcript.entries.filter((entry) => entry.kind === "tool")).toEqual([]);
      expect(transcript.totals.toolCalls).toBe(0);
    });
  });
});

describe("pi session context", () => {
  describe("given a context record and spans sharing one session id", () => {
    const sessions = foldContextRecords(
      [sessionContextRecord({ sessionId: SESSION, checkout: WIDGETS, timeMs: 30_000 })],
      foldSessions(piSession),
    );

    /** @scenario "A context record and spans sharing one session id fold into one row with its branch" */
    it("folds into the one row and gives it the repository and branch", () => {
      const row = sessions.get(SESSION);
      expect(sessions.size).toBe(1);
      expect(row?.agent).toBe("pi");
      expect([
        row?.repositoryHost,
        row?.repositoryOwner,
        row?.repositoryName,
        row?.gitBranch,
      ]).toEqual(["github.com", "acme", "widgets", "feat/pi-sessions"]);
      expect(row?.inputTokens).toBe(160);
    });
  });

  describe("given a context record under a different session id from the spans", () => {
    /** @scenario "A context record under a different session id leaves the span session without a branch" */
    it("leaves the span session's row with no repository and no branch", () => {
      const sessions = foldContextRecords(
        [sessionContextRecord({ sessionId: SESSION, checkout: WIDGETS, timeMs: 30_000 })],
        foldSessions(piSession.map((span) => withSession(span, OTHER_SESSION))),
      );
      const row = sessions.get(OTHER_SESSION);

      expect(row?.repositoryName ?? null).toBeNull();
      expect(row?.gitBranch ?? null).toBeNull();
    });
  });
});

/** The span re-keyed onto another pi session id. */
function withSession(span: CapturedSpan, sessionId: string): CapturedSpan {
  return { ...span, attributes: { ...span.attributes, "pi.session.id": sessionId } };
}

describe("pi pull-request mapping", () => {
  /** A pi row folded from its spans plus a context record naming the given checkout. */
  function rowWith(checkout: DeclaredCheckout | null): CodingAgentSessionState {
    const spans = foldSessions(piSession);
    if (checkout === null) return spans.get(SESSION)!;
    return foldContextRecords(
      [sessionContextRecord({ sessionId: SESSION, checkout, timeMs: 30_000 })],
      spans,
    ).get(SESSION)!;
  }

  /** Runs the mapping trigger on the row, returning what it asked GitHub for. */
  async function mapPullRequests(row: CodingAgentSessionState) {
    const github = TestGithubService.create();
    const requestBranchMapping = vi.spyOn(github, "requestBranchMapping");
    const event: LogFactsContributedEvent = {
      id: "evt-context",
      aggregateId: SESSION,
      aggregateType: "coding_agent_session",
      createdAt: 30_000,
      occurredAt: 30_000,
      version: "2025-01-01",
      tenantId: createTenantId("project-1"),
      type: LOG_FACTS_CONTRIBUTED_EVENT_TYPE,
      data: {
        tenantId: "project-1",
        sessionId: SESSION,
        sessionKeySource: "provider",
        agent: "pi",
        occurredAt: 30_000,
        recordId: "rec-context",
        traceId: null,
        spanId: null,
        timeUnixMs: 30_000,
        severityNumber: 9,
        providerKind: "generic",
        scopeName: "langwatch.coding_agent.hook",
        facts: {},
      },
    };
    await createPullRequestMappingHandler(github)(event, {
      tenantId: "project-1",
      aggregateId: SESSION,
      state: row,
    });
    return { github, requestBranchMapping };
  }

  /** The pull request a session is attached to, among one open on the declared branch. */
  function attachedPullRequest(row: CodingAgentSessionState): number | undefined {
    return CodingAgentPullRequestAssignmentService.create()
      .assignSessions({
        sessions: [
          { sessionId: SESSION, startedAtMs: row.startedAtMs, headBranch: row.gitBranch ?? "" },
        ],
        pullRequests: [
          {
            prNumber: 42,
            headBranch: WIDGETS.branch,
            prCreatedAtMs: 0,
            prClosedAtMs: null,
            prMergedAtMs: null,
          },
        ],
      })
      .get(SESSION);
  }

  describe("given a pi session whose context named a repository and branch with an open pull request", () => {
    /** @scenario "A pi session whose context named a repository and branch links to its pull request" */
    it("asks for its branch's pull requests and is attached to the open one", async () => {
      const row = rowWith(WIDGETS);
      const { github, requestBranchMapping } = await mapPullRequests(row);

      expect(shouldMapPullRequests(row, github)).toBe(true);
      expect(requestBranchMapping).toHaveBeenCalledWith({
        tenantId: "project-1",
        repositoryHost: "github.com",
        repositoryOwner: "acme",
        repositoryName: "widgets",
        headBranch: "feat/pi-sessions",
      });
      expect(attachedPullRequest(row)).toBe(42);
    });
  });

  describe("given a pi session whose spans arrived without any session-context record", () => {
    /** @scenario "A pi session with no context record maps no pull requests" */
    it("stages no mapping and is attached to no pull request", async () => {
      const row = rowWith(null);
      const { requestBranchMapping } = await mapPullRequests(row);

      expect(requestBranchMapping).not.toHaveBeenCalled();
      expect(attachedPullRequest(row)).toBeUndefined();
    });
  });

  describe("given a pi session whose context named a repository on a host outside GitHub", () => {
    /** @scenario "A pi session on a repository host the mapping cannot answer for is rejected" */
    it("stages no mapping job and is attached to no pull request", async () => {
      const row = rowWith({ ...WIDGETS, host: "gitlab.com" });
      const { github, requestBranchMapping } = await mapPullRequests(row);

      expect(row.repositoryHost).toBe("gitlab.com");
      expect(shouldMapPullRequests(row, github)).toBe(false);
      expect(requestBranchMapping).not.toHaveBeenCalled();
    });
  });

  describe("given a pi session whose context named a repository but no branch", () => {
    /** @scenario "A pi session with a repository but no branch is rejected" */
    it("stages no mapping job and is attached to no pull request", async () => {
      const row = rowWith({ ...WIDGETS, branch: "" });
      const { github, requestBranchMapping } = await mapPullRequests(row);

      expect(row.repositoryName).toBe("widgets");
      expect(shouldMapPullRequests(row, github)).toBe(false);
      expect(requestBranchMapping).not.toHaveBeenCalled();
      expect(attachedPullRequest(row)).toBeUndefined();
    });
  });
});
