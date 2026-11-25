/**
 * The agent call graph reads each span's kind from the stored row, so an A2A hop inside one
 * service.name still splits into the caller and the unnamed callee.
 * Spec: modules/trace/specs/agent-call-graph.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { NormalizedSpanKind, type OwnedSpan } from "@langwatch/trace-contract";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { buildAgentCallGraph } from "../../../rules/agent-call-graph.rules.ts";
import { SpanStorageClickHouseRepository } from "../span-storage.repository.ts";
import { authorizedClickHouseFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();
const PROJECT = `a2a-kind-${nanoid()}`;
const TRACE = `a2a-kind-trace-${nanoid()}`;

let ch: ClickHouseClient;
let repo: SpanStorageClickHouseRepository;
let startedAt: number;

function storedRow({
  spanId,
  parentSpanId,
  name,
  kind,
  offsetMs,
  attributes,
}: {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: NormalizedSpanKind;
  offsetMs: number;
  attributes: Record<string, string>;
}) {
  const start = startedAt + offsetMs;
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: PROJECT,
    TraceId: TRACE,
    SpanId: spanId,
    ParentSpanId: parentSpanId,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(start),
    EndTime: new Date(start + 50),
    DurationMs: 50,
    SpanName: name,
    SpanKind: kind,
    ServiceName: "shared-svc",
    ResourceAttributes: { "service.name": "shared-svc" },
    SpanAttributes: attributes,
    StatusCode: 1,
    StatusMessage: null,
    ScopeName: "test",
    ScopeVersion: null,
    "Events.Timestamp": [] as Date[],
    "Events.Name": [] as string[],
    "Events.Attributes": [] as Record<string, string>[],
    "Links.TraceId": [] as string[],
    "Links.SpanId": [] as string[],
    "Links.Attributes": [] as Record<string, string>[],
    DroppedAttributesCount: 0,
    DroppedEventsCount: 0,
    DroppedLinksCount: 0,
    CreatedAt: new Date(start),
    UpdatedAt: new Date(start),
  };
}

/** The drawer's span detail fields the graph rules take, keyed by the legacy span id. */
function graphSpanOf(span: OwnedSpan) {
  return {
    spanId: span.span_id,
    parentSpanId: span.parent_id ?? null,
    name: span.name ?? "",
    type: span.type,
    durationMs: 50,
    status: "ok" as const,
    metrics: span.metrics ?? null,
    params: span.params ?? {},
    kind: span.kind ?? null,
  };
}

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  startedAt = Date.now() - 60 * 60 * 1000;
  repo = SpanStorageClickHouseRepository.create({
    resolveClient: async () => ch,
    clickhouse: authorizedClickHouseFor(ch),
  });
  await ch.insert({
    table: "stored_spans",
    values: [
      storedRow({
        spanId: "root",
        parentSpanId: null,
        name: "handle_turn",
        kind: NormalizedSpanKind.SERVER,
        offsetMs: 0,
        attributes: {},
      }),
      storedRow({
        spanId: "client",
        parentSpanId: "root",
        name: "send_message",
        kind: NormalizedSpanKind.CLIENT,
        offsetMs: 1,
        attributes: { "a2a.method": "message/send", "a2a.agent.name": "Researcher" },
      }),
      storedRow({
        spanId: "server",
        parentSpanId: "client",
        name: "handle_request",
        kind: NormalizedSpanKind.SERVER,
        offsetMs: 2,
        attributes: { "a2a.method": "message/send" },
      }),
      storedRow({
        spanId: "llm",
        parentSpanId: "server",
        name: "chat",
        kind: NormalizedSpanKind.CLIENT,
        offsetMs: 3,
        attributes: {
          "langwatch.span.type": "llm",
          "gen_ai.usage.input_tokens": "10",
          "gen_ai.usage.output_tokens": "5",
          "langwatch.span.cost": "0.25",
        },
      }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 120_000);

describe.skipIf(!clickHouseConfigured)("the agent call graph over stored spans", () => {
  describe("given an A2A hop inside one shared service with an unnamed callee", () => {
    /** @scenario "Both sides share one service.name and the client span names the callee" */
    it("reads each span's kind from the row and gives the callee its own node and LLM cost", async () => {
      const spans = await repo.findSpansByTraceId({
        authorization: ownProof({ projectId: PROJECT }),
        traceId: TRACE,
        occurredAtMs: startedAt,
      });
      expect(spans.find((span) => span.span_id === "client")?.kind).toBe(NormalizedSpanKind.CLIENT);

      const graph = buildAgentCallGraph({
        spans: spans.map(graphSpanOf),
        resources: {
          resourceAttributes: { "service.name": "shared-svc" },
          spans: spans.map((span) => ({
            spanId: span.span_id,
            parentSpanId: span.parent_id ?? null,
            resourceAttributes: { "service.name": "shared-svc" },
            scope: { name: "test", version: null },
          })),
        },
      });

      expect(graph.nodes).toHaveLength(2);
      const callee = graph.nodes.find((node) => node.id !== "service:shared-svc");
      expect(callee?.cost).toBeCloseTo(0.25);
      expect(graph.nodes.find((node) => node.id === "service:shared-svc")?.cost ?? null).toBeNull();
    });
  });
});
