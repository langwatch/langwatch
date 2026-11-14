import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { OpsDoorAnswer, OpsExplainType } from "@langwatch/ops-contract";
import { nowInstant } from "@langwatch/time";

import { CLICKHOUSE_EXPLAIN_TENANT_ID } from "../eventing/ops-clickhouse-explain.events.ts";
import type { OpsExplainResultsRepository } from "../repositories/ops-explain-results.repository.ts";
import type { OpsExplainRepository } from "../repositories/ops-explain.repository.ts";
import { toExplainResultDoorAnswer } from "../rules/ops-door.rules.ts";

const logger = createLogger("langwatch:ops:clickhouse:explain");

export type ClickHouseExplainRequestSender = {
  send(input: { requestId: string; tenantId: string; occurredAt: number }): Promise<unknown>;
};

/**
 * The operator EXPLAIN in two halves (ADR-202 Decided 14): the api stores an accepted request and
 * sends its command; the worker runs it on the `langwatch_ops` identity and stores the answer.
 */
export class OpsExplainService {
  #sender: ClickHouseExplainRequestSender | undefined;

  static create({
    repository,
    results,
    newRequestId = () => generate("ops").toString(),
  }: {
    repository: OpsExplainRepository;
    results: OpsExplainResultsRepository;
    newRequestId?: () => string;
  }): OpsExplainService {
    return new OpsExplainService(repository, results, newRequestId);
  }

  private constructor(
    private readonly repository: OpsExplainRepository,
    private readonly results: OpsExplainResultsRepository,
    private readonly newRequestId: () => string,
  ) {}

  connect(sender: ClickHouseExplainRequestSender): void {
    this.#sender = sender;
  }

  /** Stores the request pending and hands it to a worker; the query never enters the event log. */
  async request({
    wrappedQuery,
    type,
    auditFields,
  }: {
    wrappedQuery: string;
    type: OpsExplainType;
    /** Redacted request shape for the audit log - never the raw query. */
    auditFields: Record<string, unknown>;
  }): Promise<{ requestId: string }> {
    const sender = this.#sender;
    if (!sender) throw new Error("the ops EXPLAIN command is not connected in this process");
    const requestId = this.newRequestId();
    await this.results.save({ requestId, record: { status: "pending", type, wrappedQuery } });
    await sender.send({
      requestId,
      tenantId: CLICKHOUSE_EXPLAIN_TENANT_ID,
      occurredAt: nowInstant().epochMilliseconds,
    });
    logger.info({ requestId, type, ...auditFields }, "ops explain requested");
    return { requestId };
  }

  /** The worker's half: a request already answered is left as it is, so a redelivery asks once. */
  async run({ requestId }: { requestId: string }): Promise<void> {
    const [record] = await this.results.findByRequestId({ requestId });
    if (!record) {
      logger.warn({ requestId }, "ops explain request expired before a worker ran it");
      return;
    }
    if (record.status !== "pending") return;

    const resolved = this.repository.findClient();
    if (!resolved) {
      logger.error(
        "CLICKHOUSE_OPS_URL is not set on this worker - an operator EXPLAIN never falls back to " +
          "another identity. Provision a langwatch_ops ClickHouse user with a readonly=1 profile " +
          "and no SOURCES grant, then set CLICKHOUSE_OPS_URL to it on the worker.",
      );
      await this.results.save({
        requestId,
        record: { status: "failed", reason: "not_configured" },
      });
      return;
    }

    try {
      const rows = await this.repository.runExplain({
        client: resolved.client,
        wrappedQuery: record.wrappedQuery,
      });
      await this.results.save({ requestId, record: { status: "done", type: record.type, rows } });
    } catch (err) {
      // The engine's own prose names cluster internals; it is logged, never answered.
      logger.warn(
        { requestId, err: err instanceof Error ? err.message : String(err) },
        "ops explain failed",
      );
      await this.results.save({ requestId, record: { status: "failed", reason: "refused" } });
    }
  }

  /** The door's answer for one request id: pending, the rows, the failure, or 404. */
  async result({ requestId }: { requestId: string }): Promise<OpsDoorAnswer> {
    const [record] = await this.results.findByRequestId({ requestId });
    return toExplainResultDoorAnswer(record);
  }
}
