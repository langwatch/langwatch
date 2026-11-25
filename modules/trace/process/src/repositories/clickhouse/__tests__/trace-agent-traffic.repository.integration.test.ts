/**
 * @vitest-environment node
 * The agents-seen read against production schema: an agent whose spans name two models and two
 * ids reads the ones on most spans, not the latest, the same on every read.
 * @see modules/trace/specs/trace-agent-traffic.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TraceAgentTrafficClickHouseRepository } from "../trace-agent-traffic.repository.ts";
import { traceQueryClientFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const tenantId = `test-agent-traffic-${nanoid()}`;
const base = Date.now() - 60 * 60 * 1000;

let ch: ClickHouseClient;
let repo: TraceAgentTrafficClickHouseRepository;

function spanRow({
  offsetMs,
  attributes,
}: {
  offsetMs: number;
  attributes: Record<string, string>;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: `trace-${nanoid()}`,
    SpanId: `span-${nanoid()}`,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(base + offsetMs),
    EndTime: new Date(base + offsetMs + 50),
    DurationMs: 50,
    SpanName: "invoke_agent",
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
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
    CreatedAt: new Date(base + offsetMs),
    UpdatedAt: new Date(base + offsetMs),
  };
}

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repo = TraceAgentTrafficClickHouseRepository.create(traceQueryClientFor(ch));

  // Separate inserts leave unmerged parts, so part order cannot pick the answer.
  for (const row of [
    spanRow({
      offsetMs: 0,
      attributes: {
        "gen_ai.agent.name": "planner",
        "gen_ai.agent.id": "planner-v1",
        "gen_ai.request.model": "gpt-5",
      },
    }),
    spanRow({
      offsetMs: 2_000,
      attributes: {
        "gen_ai.agent.name": "planner",
        "gen_ai.agent.id": "planner-v1",
        "gen_ai.request.model": "gpt-5",
      },
    }),
    spanRow({
      offsetMs: 3_000,
      attributes: {
        "gen_ai.agent.name": "planner",
        "gen_ai.agent.id": "planner-v2",
        "gen_ai.request.model": "gpt-5-mini",
      },
    }),
    spanRow({ offsetMs: 5_000, attributes: { "gen_ai.agent.name": "planner" } }),
  ]) {
    await ch.insert({
      table: "stored_spans",
      values: [row],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }
}, 120_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
  }
});

describe.skipIf(!clickHouseConfigured)("TraceAgentTrafficClickHouseRepository", () => {
  describe("given an agent whose spans name two models and two ids", () => {
    /** @scenario An agent seen with two models reads its most-used model on every read */
    it("answers the non-empty model and id on most spans, the same on every read", async () => {
      const read = () => repo.findAgentsSeen({ tenantId, sinceMs: base - 1_000, limit: 10 });

      const first = await read();
      const second = await read();

      expect(first).toEqual([
        {
          agentName: "planner",
          agentId: "planner-v1",
          model: "gpt-5",
          spanCount: 4,
          firstSeenMs: base,
          lastSeenMs: base + 5_000,
        },
      ]);
      expect(second).toEqual(first);
    });
  });
});
