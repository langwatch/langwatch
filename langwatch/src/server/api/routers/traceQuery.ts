import { z } from "zod";
import { runTraceQuery } from "~/server/app-layer/traces/trace-query/service";
import { traceQueryRequestSchema } from "~/server/app-layer/traces/trace-query/schema";
import { checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

/**
 * SPIKE #5670 — read-only, tenant-isolated trace query surface.
 *
 * The authz gate (`checkProjectPermission`) is load-bearing: it is the ONLY
 * place the caller's authorization for `input.projectId` is established. The
 * service then treats that RBAC-checked projectId as the tenant and the
 * compiler injects it into every table reference — the request never carries a
 * tenant of its own. The route stays thin; orchestration lives in the service.
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
    .mutation(({ input, ctx }) =>
      runTraceQuery({
        projectId: input.projectId,
        request: input.query,
        callerId: ctx.session?.user?.id,
      }),
    ),
});
