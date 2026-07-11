import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { compileTraceQuery } from "./compile";
import { executeTraceQuery } from "./execute";
import type { TraceQueryRequest } from "./schema";

/**
 * Orchestrates the read-only trace query (SPIKE #5670): compile the structured
 * request with the caller's authorized project as the tenant, resolve that
 * project's ClickHouse client, and execute read-only. Keeping this in the
 * app-layer service (rather than inlining it in the tRPC route) matches the
 * analytics `getTimeseries` pattern, keeps the route thin, and makes the
 * orchestration testable independent of tRPC.
 */
export interface RunTraceQueryArgs {
  /** The RBAC-authorized project id — this IS the tenant. Never from the body. */
  projectId: string;
  request: TraceQueryRequest;
  /** Audit dimension: who is asking. */
  callerId?: string;
}

export async function runTraceQuery({
  projectId,
  request,
  callerId,
}: RunTraceQueryArgs) {
  const tenantId = projectId;

  const compiled = compileTraceQuery({ request, tenantId });

  const client = await getClickHouseClientForProject(tenantId);
  if (!client) {
    throw new Error("ClickHouse is not configured for this project");
  }

  const { rows, audit } = await executeTraceQuery({
    compiled,
    client,
    tenantId,
    caller: callerId,
  });

  // `sql` is returned for the spike demo so a human can SEE the compiler-injected
  // tenant scope; params (bound literals) are withheld.
  return { rows, sql: compiled.sql, audit, rowCount: rows.length };
}
