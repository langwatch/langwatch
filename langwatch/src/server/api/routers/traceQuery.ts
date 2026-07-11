import { z } from "zod";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { compileTraceQuery } from "~/server/app-layer/traces/trace-query/compile";
import { executeTraceQuery } from "~/server/app-layer/traces/trace-query/execute";
import { traceQueryRequestSchema } from "~/server/app-layer/traces/trace-query/schema";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * SPIKE #5670 — read-only, tenant-isolated trace query surface.
 *
 * The authz gate (`checkProjectPermission`) is load-bearing: it is the ONLY
 * place the caller's authorization for `input.projectId` is established. The
 * compiler then treats that RBAC-checked projectId as the tenant and injects
 * it into every table reference — the request never carries a tenant of its
 * own. This is the composition the spike validates: session auth → derive
 * tenant → compiler-injected scope → read-only execution.
 */
export const traceQueryRouter = createTRPCRouter({
  run: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        query: traceQueryRequestSchema,
      }),
    )
    .use(checkProjectPermission("analytics:view"))
    .mutation(async ({ input, ctx }) => {
      // The tenant is the authorized project — derived from the RBAC-checked
      // input, never a separate tenant field on the body.
      const tenantId = input.projectId;

      const compiled = compileTraceQuery({ request: input.query, tenantId });

      const client = await getClickHouseClientForProject(tenantId);
      if (!client) {
        throw new Error("ClickHouse is not configured for this project");
      }

      const { rows, audit } = await executeTraceQuery({
        compiled,
        client,
        tenantId,
        caller: ctx.session?.user?.id,
      });

      // The compiled SQL is returned for the spike demo so a human can SEE the
      // compiler-injected tenant scope. `params` are withheld (they carry the
      // bound literals); `audit` is the redacted shape that would be logged.
      return { rows, sql: compiled.sql, audit, rowCount: rows.length };
    }),
});
