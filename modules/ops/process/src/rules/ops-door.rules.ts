import type { OpsDoorAnswer, OpsDoorStatus, OpsExplainAnswer } from "@langwatch/ops-contract";

const DOOR_STATUSES: readonly OpsDoorStatus[] = [
  200, 201, 400, 401, 403, 404, 409, 413, 422, 429, 500, 502, 503,
];

/** The posted document, or undefined where the body was not JSON. */
export function parseJsonDocument(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Rate-limit bucket for the caller. `x-forwarded-for` is only trustworthy from
 * the hop nearest us, which is why this reads the LAST entry.
 */
export function toCallerKey(forwardedFor: string | null): string {
  const hops = forwardedFor?.split(",") ?? [];
  const nearest = hops[hops.length - 1]?.trim();

  return `ip:${nearest ?? "unknown"}`;
}

/** The bearer token an `authorization` header presented, or null. */
export function extractBearerSecret(authorization: string | null): string | null {
  const bearer = authorization ? /^Bearer\s+(.+)$/i.exec(authorization.trim()) : null;

  return bearer?.[1]?.trim() ?? null;
}

/** A handled error's status as a door writes it; one outside the door's codes answers 500. */
export function toDoorStatus(httpStatus: number): OpsDoorStatus {
  return DOOR_STATUSES.find((status) => status === httpStatus) ?? 500;
}

/** One EXPLAIN answer, in the exact body the operator tool already parses. */
export function toExplainDoorAnswer(answer: OpsExplainAnswer): OpsDoorAnswer {
  switch (answer.status) {
    case "ok":
      return { status: 200, body: { type: answer.type, rows: answer.rows } };
    case "refused":
      return { status: 400, body: { message: answer.reason } };
    case "not_configured_in_production":
      return {
        status: 503,
        body: {
          message:
            "ClickHouse ops user is not configured on this instance (CLICKHOUSE_OPS_URL unset in production).",
        },
      };
    case "unavailable":
      return { status: 503, body: { message: "ClickHouse is not configured on this instance" } };
    case "failed":
      return { status: 502, body: { message: "ClickHouse refused the EXPLAIN" } };
  }
}
