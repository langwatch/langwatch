import type { OpsDoorAnswer, OpsDoorStatus, OpsExplainAnswer } from "@langwatch/ops-contract";

import type { OpsExplainRecord } from "../repositories/ops-explain-results.repository.ts";

const DOOR_STATUSES: readonly OpsDoorStatus[] = [
  200, 201, 202, 400, 401, 403, 404, 409, 413, 422, 429, 500, 502, 503,
];

/**
 * Rate-limit bucket for the caller: the address the door resolved, never a forwarding header.
 * An unresolved caller shares the one unknown bucket.
 */
export function toCallerKey(callerAddress: string | null): string {
  return `ip:${callerAddress ?? "unknown"}`;
}

/** A handled error's status as a door writes it; one outside the door's codes answers 500. */
export function toDoorStatus(httpStatus: number): OpsDoorStatus {
  return DOOR_STATUSES.find((status) => status === httpStatus) ?? 500;
}

/** An accepted EXPLAIN is a request id the tool polls; a refused one answers at once. */
export function toExplainDoorAnswer(answer: OpsExplainAnswer): OpsDoorAnswer {
  switch (answer.status) {
    case "accepted":
      return { status: 202, body: { requestId: answer.requestId } };
    case "refused":
      return { status: 400, body: { message: answer.reason } };
  }
}

/** One request's answer on `GET /api/ops/clickhouse/explain/:requestId` (ADR-202 Decided 14). */
export function toExplainResultDoorAnswer(record: OpsExplainRecord | undefined): OpsDoorAnswer {
  switch (record?.status) {
    case undefined:
      return {
        status: 404,
        body: { message: "No EXPLAIN request has that id, or its result has expired" },
      };
    case "pending":
      return { status: 200, body: { status: "pending" } };
    case "done":
      return { status: 200, body: { status: "done", type: record.type, rows: record.rows } };
    case "failed":
      return {
        status: 200,
        body: {
          status: "failed",
          error:
            record.reason === "not_configured"
              ? {
                  code: "clickhouse_ops_not_configured",
                  message: "ClickHouse ops user is not configured on this instance",
                }
              : { code: "clickhouse_explain_refused", message: "ClickHouse refused the EXPLAIN" },
        },
      };
  }
}
