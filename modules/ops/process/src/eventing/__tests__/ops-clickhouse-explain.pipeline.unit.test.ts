/** Spec: modules/ops/specs/clickhouse-explain.feature */
import { createTenantId, InMemoryProcessStore } from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";

import { RequestClickHouseExplainCommand } from "../ops-clickhouse-explain.commands.ts";
import {
  CLICKHOUSE_EXPLAIN_AGGREGATE_TYPE,
  CLICKHOUSE_EXPLAIN_PIPELINE_NAME,
  CLICKHOUSE_EXPLAIN_TENANT_ID,
} from "../ops-clickhouse-explain.events.ts";
import {
  buildClickHouseExplain,
  clickhouseExplainEventing,
} from "../ops-clickhouse-explain.pipeline.ts";
import {
  CLICKHOUSE_EXPLAIN_PROCESS_NAME,
  onClickHouseExplainRequested,
} from "../ops-clickhouse-explain.process.ts";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const request = { requestId: "explain_1" };

function requested() {
  return onClickHouseExplainRequested({ requestedAt: null }, request, {
    at: NOW,
    now: NOW,
    key: request.requestId,
    projectId: CLICKHOUSE_EXPLAIN_TENANT_ID,
    intent: intentAccessorOf({
      explain: (messageKey, payload) => ({ messageKey, intentType: "explain", payload }),
    }),
  });
}

describe("given ops's EXPLAIN declaration", () => {
  /** @scenario "An accepted EXPLAIN answers 202 with a request id and runs on the worker" */
  it("files the request as one event carrying the request id and not the query", async () => {
    const events = await new RequestClickHouseExplainCommand().handle({
      tenantId: createTenantId(CLICKHOUSE_EXPLAIN_TENANT_ID),
      aggregateId: request.requestId,
      type: "lw.ops.clickhouse_explain.request",
      data: { ...request, tenantId: CLICKHOUSE_EXPLAIN_TENANT_ID, occurredAt: NOW },
    });

    expect(clickhouseExplainEventing.pipeline).toBe(CLICKHOUSE_EXPLAIN_PIPELINE_NAME);
    expect(events).toEqual([
      expect.objectContaining({
        aggregateType: CLICKHOUSE_EXPLAIN_AGGREGATE_TYPE,
        aggregateId: request.requestId,
        data: request,
      }),
    ]);
  });

  /** @scenario "A redelivered EXPLAIN request stores its rows once" */
  it("asks for one EXPLAIN per request, keyed by the request", () => {
    const evolution = requested();

    expect(evolution.intents).toEqual([
      expect.objectContaining({ messageKey: "explain:explain_1", intentType: "explain" }),
    ]);
    expect(requested().intents?.[0]?.messageKey).toBe(evolution.intents?.[0]?.messageKey);
  });

  /** @scenario "An accepted EXPLAIN answers 202 with a request id and runs on the worker" */
  it("runs the EXPLAIN through the worker's intent", async () => {
    const runClickHouseExplain = vi.fn<(input: { requestId: string }) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const definition = buildClickHouseExplain({
      participation: "consume",
      repositories: undefined,
      app: { runClickHouseExplain },
      processStore: InMemoryProcessStore.createForTesting(),
    });
    const process = definition.processManagers.get(CLICKHOUSE_EXPLAIN_PROCESS_NAME);
    if (!process) throw new Error("the declaration built no EXPLAIN process manager");

    await process.config.intents?.explain?.run(request, {
      processName: CLICKHOUSE_EXPLAIN_PROCESS_NAME,
      projectId: CLICKHOUSE_EXPLAIN_TENANT_ID,
      processKey: request.requestId,
      tenantId: CLICKHOUSE_EXPLAIN_TENANT_ID,
      messageKey: "explain:explain_1",
      attempt: 1,
    });

    expect(runClickHouseExplain).toHaveBeenCalledWith(request);
  });
});
