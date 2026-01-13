import { PublicShareResourceTypes } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { TraceService } from "~/server/traces/trace.service";
import { checkPermissionOrPubliclyShared } from "../permission";
import { checkProjectPermission } from "../rbac";
import { getUserProtectionsForProject } from "../utils";

export const spansRouter = createTRPCRouter({
  getAllForTrace: publicProcedure
    .input(z.object({ projectId: z.string(), traceId: z.string() }))
    .use(
      checkPermissionOrPubliclyShared(checkProjectPermission("traces:view"), {
        resourceType: PublicShareResourceTypes.TRACE,
        resourceParam: "traceId",
      }),
    )
    .query(async ({ input, ctx }) => {
      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });

      const traceService = TraceService.create(ctx.prisma);
      const traces = await traceService.getTracesWithSpans(input.projectId, [input.traceId], protections);
      if (traces.length === 0) {
        return [];
      }

      const trace = traces.find((t) => t.trace_id === input.traceId);
      if (!trace) {
        return [];
      }
      if (!trace.spans) {
        return [];
      }

      const sortedSpans = trace.spans.sort((a, b) => {
        const aStart = a.timestamps?.started_at ?? 0;
        const bStart = b.timestamps?.started_at ?? 0;

        const startDiff = aStart - bStart;
        if (startDiff === 0) {
          const aEnd = a.timestamps?.finished_at ?? 0;
          const bEnd = b.timestamps?.finished_at ?? 0;
          return bEnd - aEnd;
        }

        return startDiff;
      });

      return sortedSpans;
    }),

  getForPromptStudio: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        spanId: z.string(),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input, ctx }) => {
      const { projectId, spanId } = input;

      const protections = await getUserProtectionsForProject(ctx, {
        projectId,
      });

      const traceService = TraceService.create(ctx.prisma);
      const result = await traceService.getSpanForPromptStudio(
        projectId,
        spanId,
        protections
      );

      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Span not found or is not an LLM span.",
        });
      }

      return result;
    }),
});
