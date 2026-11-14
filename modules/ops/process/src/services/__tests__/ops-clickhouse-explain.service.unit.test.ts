/** Spec: modules/ops/specs/clickhouse-explain.feature (ADR-202 Decided 14) */
import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it, vi } from "vitest";

import { MemoryOpsExplainResultsRepository } from "../../repositories/memory/memory.ops-explain-results.repository.ts";
import { MemoryOpsStore } from "../../repositories/memory/memory.ops.store.ts";
import {
  OPS_EXPLAIN_RESULT_TTL_SECONDS,
  type OpsExplainResultsRepository,
} from "../../repositories/ops-explain-results.repository.ts";
import {
  type OpsExplainClientResolution,
  OpsExplainRepository,
} from "../../repositories/ops-explain.repository.ts";
import { OpsExplainService } from "../ops-clickhouse-explain.service.ts";

const ROWS = [{ explain: "ReadFromMergeTree (langwatch.stored_spans)" }];

class StubExplainRepository extends OpsExplainRepository {
  readonly runExplain = vi.fn<OpsExplainRepository["runExplain"]>(async () => ROWS);
  constructor(private readonly configured: boolean) {
    super();
  }
  findClient(): OpsExplainClientResolution | null {
    return this.configured ? { client: {} as ClickHouseClient } : null;
  }
}

function serviceWith({
  configured = true,
  now = () => 0,
}: { configured?: boolean; now?: () => number } = {}) {
  const repository = new StubExplainRepository(configured);
  const results: OpsExplainResultsRepository = MemoryOpsExplainResultsRepository.create({
    store: MemoryOpsStore.create(),
    now,
  });
  const send = vi.fn(async () => undefined);
  const service = OpsExplainService.create({ repository, results, newRequestId: () => "req_1" });
  service.connect({ send });
  const accept = () =>
    service.request({ wrappedQuery: "EXPLAIN PLAN SELECT 1", type: "PLAN", auditFields: {} });
  return { service, repository, send, accept };
}

describe("given an operator EXPLAIN the api accepted", () => {
  /** @scenario "An accepted EXPLAIN answers 202 with a request id and runs on the worker" */
  it("stores it pending and sends the request id alone", async () => {
    const { accept, send } = serviceWith();

    expect(await accept()).toEqual({ requestId: "req_1" });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ requestId: "req_1" }));
    expect(JSON.stringify(send.mock.calls)).not.toContain("SELECT");
  });

  /** @scenario "The result answers pending until the worker stores the rows" */
  it("answers pending, then the rows once the worker ran it on the ops identity", async () => {
    const { service, accept } = serviceWith();
    await accept();

    expect(await service.result({ requestId: "req_1" })).toEqual({
      status: 200,
      body: { status: "pending" },
    });
    await service.run({ requestId: "req_1" });
    expect(await service.result({ requestId: "req_1" })).toEqual({
      status: 200,
      body: { status: "done", type: "PLAN", rows: ROWS },
    });
  });

  /** @scenario "An unknown request id answers 404" */
  it("answers 404 for a request id it never accepted", async () => {
    const { service } = serviceWith();

    expect((await service.result({ requestId: "never" })).status).toBe(404);
  });

  /** @scenario "An expired result answers 404" */
  it("answers 404 once the result outlived its time to live", async () => {
    let clock = 0;
    const { service, accept } = serviceWith({ now: () => clock });
    await accept();
    await service.run({ requestId: "req_1" });
    clock += OPS_EXPLAIN_RESULT_TTL_SECONDS * 1000;

    expect((await service.result({ requestId: "req_1" })).status).toBe(404);
  });

  /** @scenario "A worker without the ops identity records a failed result" */
  it("records not configured and never falls back to another identity", async () => {
    const { service, repository, accept } = serviceWith({ configured: false });
    await accept();
    await service.run({ requestId: "req_1" });

    expect(repository.runExplain).not.toHaveBeenCalled();
    expect((await service.result({ requestId: "req_1" })).body).toMatchObject({
      status: "failed",
      error: { code: "clickhouse_ops_not_configured" },
    });
  });

  /** @scenario "An EXPLAIN that ClickHouse refuses records a failed result without the engine prose" */
  it("records the refusal without the engine's message", async () => {
    const { service, repository, accept } = serviceWith();
    repository.runExplain.mockRejectedValueOnce(new Error("Code: 62. cluster-internal-host"));
    await accept();
    await service.run({ requestId: "req_1" });

    const { body } = await service.result({ requestId: "req_1" });
    expect(body).toEqual({
      status: "failed",
      error: { code: "clickhouse_explain_refused", message: "ClickHouse refused the EXPLAIN" },
    });
    expect(JSON.stringify(body)).not.toContain("cluster-internal-host");
  });

  /** @scenario "A redelivered EXPLAIN request stores its rows once" */
  it("asks ClickHouse once when the request is delivered twice", async () => {
    const { service, repository, accept } = serviceWith();
    await accept();
    await service.run({ requestId: "req_1" });
    await service.run({ requestId: "req_1" });

    expect(repository.runExplain).toHaveBeenCalledTimes(1);
    expect((await service.result({ requestId: "req_1" })).body).toMatchObject({ rows: ROWS });
  });
});
