/** Spec: modules/ops/specs/event-log-search.feature (ADR-202 Decided 14) */
import type { AggregateDiscovery, AggregateSearchResult } from "@langwatch/ops-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryOpsEventLogSearchResultsRepository } from "../../repositories/memory/memory.ops-event-log-search-results.repository.ts";
import { MemoryOpsStore } from "../../repositories/memory/memory.ops.store.ts";
import { OPS_EVENT_LOG_SEARCH_RESULT_TTL_SECONDS } from "../../repositories/ops-event-log-search-results.repository.ts";
import { OpsEventLogSearchService } from "../ops-event-log-search.service.ts";

const OPERATOR = "user_operator";
const SINCE_MS = Date.parse("2025-11-14T00:00:00Z");
const MATCHES: AggregateSearchResult[] = [
  {
    aggregateId: "trace_abc",
    aggregateType: "trace",
    tenantId: "project_1",
    eventCount: 3,
    lastEventTime: "1763121600000",
  },
];

const COUNTS: AggregateDiscovery = {
  projections: [{ projectionName: "trace_summary", aggregateCount: 2, tenantBreakdown: [] }],
};

function serviceWith({
  now = () => 0,
  searchAggregates = vi.fn(async () => MATCHES),
  discoverAggregates = vi.fn(async () => COUNTS),
}: {
  now?: () => number;
  searchAggregates?: (input: {
    query: string;
    tenantIds: string[];
    sinceMs: number;
  }) => Promise<AggregateSearchResult[]>;
  discoverAggregates?: (input: {
    projectionNames: string[];
    since: string;
    tenantIds: string[];
  }) => Promise<AggregateDiscovery>;
} = {}) {
  const explorer = {
    searchAggregates: vi.fn(searchAggregates),
    discoverAggregates: vi.fn(discoverAggregates),
  };
  const results = MemoryOpsEventLogSearchResultsRepository.create({
    store: MemoryOpsStore.create(),
    now,
  });
  const requestSend = vi.fn(async () => undefined);
  const completeSend = vi.fn(async () => undefined);
  const service = OpsEventLogSearchService.create({
    explorer,
    results,
    newRequestId: () => "ops_search_1",
  });
  service.connect({
    requestEventLogSearch: { send: requestSend },
    recordEventLogSearchCompleted: { send: completeSend },
  });
  const accept = (query = "trace_abc", tenantIds: string[] = []) =>
    service.request({ query, tenantIds, sinceMs: SINCE_MS, requestedBy: OPERATOR });
  const runOnWorker = () => service.run({ requestId: "ops_search_1", tenantId: OPERATOR });
  const acceptCount = () =>
    service.requestDiscovery({
      projectionNames: ["trace_summary"],
      since: "2025-11-14",
      tenantIds: ["project_1"],
      requestedBy: OPERATOR,
    });
  return { service, explorer, requestSend, completeSend, accept, acceptCount, runOnWorker };
}

describe("given an event-log search the api accepted", () => {
  /** @scenario "An accepted search sends one command under the operator and answers its request id" */
  it("stores it pending and sends the request id alone under the operator's tenant", async () => {
    const { accept, service, requestSend, explorer } = serviceWith();

    expect(await accept()).toEqual({ requestId: "ops_search_1" });
    expect(requestSend).toHaveBeenCalledTimes(1);
    expect(requestSend).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "ops_search_1", tenantId: OPERATOR }),
    );
    expect(JSON.stringify(requestSend.mock.calls)).not.toContain("trace_abc");
    expect(explorer.searchAggregates).not.toHaveBeenCalled();
    expect(await service.result({ requestId: "ops_search_1" })).toEqual({ status: "pending" });
  });

  /** @scenario "A search with no query and no tenant sends no command" */
  it("refuses an unbounded search before storing or sending anything", async () => {
    const { accept, service, requestSend } = serviceWith();

    const refusal = await accept("   ", []).catch((error: unknown) => error);

    expect(refusal).toMatchObject({ code: "ops_search_query_required", httpStatus: 400 });
    expect(requestSend).not.toHaveBeenCalled();
    expect(await service.result({ requestId: "ops_search_1" })).toEqual({ status: "expired" });
  });

  /** @scenario "The worker runs the search and stores the matches under the request id" */
  it("asks the explorer with the api's bounds, stores the matches and records the completion", async () => {
    let nowMs = 0;
    const { accept, runOnWorker, service, explorer, completeSend } = serviceWith({
      now: () => nowMs,
    });
    await accept("trace_abc", ["project_1"]);

    await runOnWorker();

    expect(explorer.searchAggregates).toHaveBeenCalledWith({
      query: "trace_abc",
      tenantIds: ["project_1"],
      sinceMs: SINCE_MS,
    });
    expect(await service.result({ requestId: "ops_search_1" })).toEqual({
      status: "done",
      results: MATCHES,
    });
    expect(completeSend).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "ops_search_1", tenantId: OPERATOR }),
    );
    nowMs = OPS_EVENT_LOG_SEARCH_RESULT_TTL_SECONDS * 1000 + 1;
    expect(await service.result({ requestId: "ops_search_1" })).toEqual({ status: "expired" });
  });

  /** @scenario "The result answers pending until the worker stores the matches" */
  it("answers pending while no worker has run it", async () => {
    const { accept, service } = serviceWith();
    await accept();

    expect(await service.result({ requestId: "ops_search_1" })).toEqual({ status: "pending" });
  });

  /** @scenario "An unknown or expired search answers expired" */
  it("answers expired for an id it never accepted, and after the TTL", async () => {
    let nowMs = 0;
    const { accept, service, runOnWorker, completeSend, explorer } = serviceWith({
      now: () => nowMs,
    });

    expect(await service.result({ requestId: "ops_unknown" })).toEqual({ status: "expired" });
    await accept();
    nowMs = OPS_EVENT_LOG_SEARCH_RESULT_TTL_SECONDS * 1000 + 1;
    await runOnWorker();

    expect(explorer.searchAggregates).not.toHaveBeenCalled();
    expect(completeSend).toHaveBeenCalledTimes(1);
    expect(await service.result({ requestId: "ops_search_1" })).toEqual({ status: "expired" });
  });

  /** @scenario "A search the worker could not run is recorded failed" */
  it("stores the failure with none of the engine's text and still records the completion", async () => {
    const { accept, service, runOnWorker, completeSend } = serviceWith({
      searchAggregates: async () => {
        throw new Error("Code: 241. Memory limit exceeded on host ch-0");
      },
    });
    await accept();

    await runOnWorker();

    const answer = await service.result({ requestId: "ops_search_1" });
    expect(answer).toEqual({ status: "failed" });
    expect(JSON.stringify(answer)).not.toContain("ch-0");
    expect(completeSend).toHaveBeenCalledTimes(1);
  });

  /** @scenario "A redelivered search reads the event log once" */
  it("reads the event log once when the search is delivered twice", async () => {
    const { accept, runOnWorker, explorer, completeSend } = serviceWith();
    await accept();

    await runOnWorker();
    await runOnWorker();

    expect(explorer.searchAggregates).toHaveBeenCalledTimes(1);
    expect(completeSend).toHaveBeenCalledTimes(2);
    expect(completeSend).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ requestId: "ops_search_1", tenantId: OPERATOR }),
    );
  });
});

describe("given the replay wizard's aggregate count the api accepted", () => {
  /** @scenario "The replay wizard's aggregate count runs in the worker" */
  it("stores it pending, counts on the worker, stores the counts and records the completion", async () => {
    const { acceptCount, runOnWorker, service, explorer, requestSend, completeSend } =
      serviceWith();

    expect(await acceptCount()).toEqual({ requestId: "ops_search_1" });
    expect(requestSend).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "ops_search_1", tenantId: OPERATOR }),
    );
    expect(JSON.stringify(requestSend.mock.calls)).not.toContain("project_1");
    expect(await service.discovery({ requestId: "ops_search_1" })).toEqual({ status: "pending" });

    await runOnWorker();

    expect(explorer.discoverAggregates).toHaveBeenCalledWith({
      projectionNames: ["trace_summary"],
      since: "2025-11-14",
      tenantIds: ["project_1"],
    });
    expect(explorer.searchAggregates).not.toHaveBeenCalled();
    expect(await service.discovery({ requestId: "ops_search_1" })).toEqual({
      status: "done",
      discovery: COUNTS,
    });
    expect(await service.result({ requestId: "ops_search_1" })).toEqual({ status: "expired" });
    expect(completeSend).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "ops_search_1", tenantId: OPERATOR }),
    );
  });

  /** @scenario "An aggregate count the worker could not run is recorded failed" */
  it("stores the failure with none of the engine's text and still records the completion", async () => {
    const { acceptCount, runOnWorker, service, completeSend } = serviceWith({
      discoverAggregates: async () => {
        throw new Error("Code: 159. Timeout exceeded on host ch-0");
      },
    });
    await acceptCount();

    await runOnWorker();

    const answer = await service.discovery({ requestId: "ops_search_1" });
    expect(answer).toEqual({ status: "failed" });
    expect(JSON.stringify(answer)).not.toContain("ch-0");
    expect(completeSend).toHaveBeenCalledTimes(1);
  });

  /** @scenario "An unknown or expired aggregate count answers expired" */
  it("answers expired for an id it never accepted, a search's id, and after the TTL", async () => {
    let nowMs = 0;
    const { accept, acceptCount, service } = serviceWith({ now: () => nowMs });

    expect(await service.discovery({ requestId: "ops_unknown" })).toEqual({ status: "expired" });
    await accept();
    expect(await service.discovery({ requestId: "ops_search_1" })).toEqual({ status: "expired" });
    await acceptCount();
    nowMs = OPS_EVENT_LOG_SEARCH_RESULT_TTL_SECONDS * 1000 + 1;
    expect(await service.discovery({ requestId: "ops_search_1" })).toEqual({ status: "expired" });
  });
});
