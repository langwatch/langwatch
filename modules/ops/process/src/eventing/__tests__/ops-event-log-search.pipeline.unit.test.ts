/** Spec: modules/ops/specs/event-log-search.feature (ADR-202 Decided 14) */
import { createTenantId, InMemoryProcessStore } from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
import {
  OPS_EVENT_LOG_SEARCH_COMPLETED_EVENT_TYPE,
  opsEventLogTrpc,
} from "@langwatch/ops-contract";
import { describe, expect, it, vi } from "vitest";

import {
  RecordEventLogSearchCompletedCommand,
  RequestEventLogSearchCommand,
} from "../ops-event-log-search.commands.ts";
import {
  EVENT_LOG_SEARCH_AGGREGATE_TYPE,
  EVENT_LOG_SEARCH_PIPELINE_NAME,
} from "../ops-event-log-search.events.ts";
import { buildEventLogSearch, eventLogSearchEventing } from "../ops-event-log-search.pipeline.ts";
import {
  EVENT_LOG_SEARCH_PROCESS_NAME,
  onEventLogSearchRequested,
} from "../ops-event-log-search.process.ts";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const OPERATOR = "user_operator";
const request = { requestId: "ops_search_1" };

function requested() {
  return onEventLogSearchRequested({ requestedAt: null }, request, {
    at: NOW,
    now: NOW,
    key: request.requestId,
    projectId: OPERATOR,
    intent: intentAccessorOf({
      search: (messageKey, payload) => ({ messageKey, intentType: "search", payload }),
    }),
  });
}

describe("given ops's event-log search declaration", () => {
  /** @scenario "An accepted search sends one command under the operator and answers its request id" */
  it("files the request under the operator as one event carrying only the request id", async () => {
    const events = await new RequestEventLogSearchCommand().handle({
      tenantId: createTenantId(OPERATOR),
      aggregateId: request.requestId,
      type: "lw.ops.event_log_search.request",
      data: { ...request, tenantId: OPERATOR, occurredAt: NOW },
    });

    expect(eventLogSearchEventing.pipeline).toBe(EVENT_LOG_SEARCH_PIPELINE_NAME);
    expect(events).toEqual([
      expect.objectContaining({
        aggregateType: EVENT_LOG_SEARCH_AGGREGATE_TYPE,
        aggregateId: request.requestId,
        tenantId: OPERATOR,
        data: request,
      }),
    ]);
  });

  /** @scenario "A redelivered search reads the event log once" */
  it("asks for one search per request, and keys its completion by the request", async () => {
    const evolution = requested();
    const complete = () =>
      new RecordEventLogSearchCompletedCommand().handle({
        tenantId: createTenantId(OPERATOR),
        aggregateId: request.requestId,
        type: "lw.ops.event_log_search.complete",
        data: { ...request, tenantId: OPERATOR, occurredAt: NOW },
      });

    expect(evolution.intents).toEqual([
      expect.objectContaining({ messageKey: "search:ops_search_1", intentType: "search" }),
    ]);
    expect(requested().intents?.[0]?.messageKey).toBe(evolution.intents?.[0]?.messageKey);
    const [first] = await complete();
    const [again] = await complete();
    expect(first).toMatchObject({
      type: OPS_EVENT_LOG_SEARCH_COMPLETED_EVENT_TYPE,
      idempotencyKey: "event_log_search_completed:ops_search_1",
    });
    expect(again?.idempotencyKey).toBe(first?.idempotencyKey);
  });

  /** @scenario "The worker runs the search and stores the matches under the request id" */
  it("runs the search through the worker's intent, under the event's tenant", async () => {
    const runAggregateSearch = vi.fn<
      (input: { requestId: string; tenantId: string }) => Promise<void>
    >(() => Promise.resolve());
    const definition = buildEventLogSearch({
      participation: "consume",
      repositories: undefined,
      app: { runAggregateSearch },
      processStore: InMemoryProcessStore.createForTesting(),
    });
    const process = definition.processManagers.get(EVENT_LOG_SEARCH_PROCESS_NAME);
    if (!process) throw new Error("the declaration built no search process manager");

    await process.config.intents?.search?.run(request, {
      processName: EVENT_LOG_SEARCH_PROCESS_NAME,
      projectId: OPERATOR,
      processKey: request.requestId,
      tenantId: OPERATOR,
      messageKey: "search:ops_search_1",
      attempt: 1,
    });

    expect(runAggregateSearch).toHaveBeenCalledWith({ ...request, tenantId: OPERATOR });
  });

  /** @scenario "The result read is invalidated by the completed search" */
  it("names the completed search as what makes the result read stale", () => {
    expect(opsEventLogTrpc.members.getAggregateSearch.invalidatedBy).toEqual([
      OPS_EVENT_LOG_SEARCH_COMPLETED_EVENT_TYPE,
    ]);
  });
});
