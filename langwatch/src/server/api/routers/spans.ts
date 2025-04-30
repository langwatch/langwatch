import { PublicShareResourceTypes } from "@prisma/client";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  TeamRoleGroup,
  checkPermissionOrPubliclyShared,
  checkUserPermissionForProject,
} from "../permission";
import { getUserProtectionsForProject } from "../utils";
import { getTraceById } from "~/server/elasticsearch/traces";

export const spansRouter = createTRPCRouter({
  getAllForTrace: publicProcedure
    .input(z.object({ projectId: z.string(), traceId: z.string() }))
    .use(
      checkPermissionOrPubliclyShared(
        checkUserPermissionForProject(TeamRoleGroup.SPANS_DEBUG),
        {
          resourceType: PublicShareResourceTypes.TRACE,
          resourceParam: "traceId",
        }
      )
    )
    .query(async ({ input, ctx }) => {
      const protections = await getUserProtectionsForProject(ctx, { projectId: input.projectId });

      const trace = await getTraceById({
        connConfig: { projectId: input.projectId },
        traceId: input.traceId,
        protections,
        includeSpans: true,
      });
      if (!trace?.spans) {
        return [];
      }

      const sortedSpans = trace.spans
        .sort((a, b) => {
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
});
