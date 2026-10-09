import type { Authorization } from "@langwatch/actor";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import {
  promptStudioLlmRowFromTrace,
  promptStudioRowFromStoredSpan,
  promptStudioSpanFromLlmRow,
} from "~/server/traces/prompt-studio-span";
import { TraceService } from "~/server/traces/trace.service";
import { buildTraceBlobResolutionDeps } from "~/server/traces/trace-blob-resolution.deps";
import {
  occurredAtFromInput,
  spanReadHintShape,
  traceDetailAuthorization,
} from "../trace-detail-authorization";
import {
  getUserProtectionsForProject,
  getVisibilityCutoffMsForProject,
} from "../utils";

export const spansRouter = createTRPCRouter({
  getAllForTrace: protectedProcedure
    .input(z.object({ projectId: z.string(), traceId: z.string() }))
    .permission("traces:view")
    .query(async ({ input, ctx }) => {
      const protections = await getUserProtectionsForProject(ctx, {
        projectId: input.projectId,
      });

      const traceService = TraceService.create(
        ctx.prisma,
        buildTraceBlobResolutionDeps(),
      );
      const traces = await traceService.getTracesWithSpans(
        input.projectId,
        [input.traceId],
        protections,
        undefined,
        { full: true },
      );
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

  getForPromptStudio: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        spanId: z.string(),
        /**
         * The trace the span belongs to, when the link names it. Named, the
         * read goes through the route's proof, narrowed to the member that
         * holds the trace on an aggregate (ADR-144 block F). A link that
         * names only the span reads the URL project, as it always has.
         */
        traceId: z.string().min(1).optional(),
        ...spanReadHintShape,
      }),
    )
    .permission("traces:view")
    .query(async ({ input, ctx }) => {
      const result =
        input.traceId === undefined
          ? await readProjectSpanForPromptStudio({ ctx, input })
          : await readTraceSpanForPromptStudio({
              authorization: await traceDetailAuthorization({
                ctx,
                input: { traceId: input.traceId, tenantId: input.tenantId },
              }),
              projectId: input.projectId,
              traceId: input.traceId,
              spanId: input.spanId,
              ...occurredAtFromInput(input),
            });

      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Span not found or is not an LLM span.",
        });
      }

      return result;
    }),
});

/**
 * The playground's read for a link that names only the span: the URL
 * project's own spans, found by span id. An aggregate holds no spans of its
 * own, so its links name the trace and take the read through the proof.
 */
async function readProjectSpanForPromptStudio({
  ctx,
  input,
}: {
  ctx: Parameters<typeof getUserProtectionsForProject>[0];
  input: { projectId: string; spanId: string };
}) {
  const protections = await getUserProtectionsForProject(ctx, {
    projectId: input.projectId,
  });
  const traceService = TraceService.create(
    ctx.prisma,
    buildTraceBlobResolutionDeps(),
  );
  return traceService.getSpanForPromptStudio(
    input.projectId,
    input.spanId,
    protections,
  );
}

/**
 * The playground's read through the proof: every span of the named trace,
 * from the tenants the proof reads, resolved to the llm span to load. That
 * span's offloaded IO is restored only when the proof reads one project and
 * the span is inside the plan's visibility window; otherwise the stored
 * preview loads.
 */
async function readTraceSpanForPromptStudio({
  authorization,
  projectId,
  traceId,
  spanId,
  occurredAtMs,
}: {
  authorization: Authorization;
  projectId: string;
  traceId: string;
  spanId: string;
  occurredAtMs?: number;
}) {
  const spans = await getApp().traces.spans.getStoredSpansByTraceId({
    authorization,
    traceId,
    ...(occurredAtMs !== undefined ? { occurredAtMs } : {}),
  });
  const rows = spans.map(promptStudioRowFromStoredSpan);
  const row = promptStudioLlmRowFromTrace({ rows, spanId });
  if (!row) return null;
  // rows is index-aligned with spans, and the llm row is one of rows.
  const stored = spans[rows.indexOf(row)];
  if (!stored) throw new Error("llm row has no stored span");
  const SpanAttributes =
    await getApp().traces.spans.restoreStoredSpanAttributes({
      authorization,
      span: stored,
      visibilityCutoffMs: await getVisibilityCutoffMsForProject(projectId),
    });
  return promptStudioSpanFromLlmRow({ row: { ...row, SpanAttributes }, rows });
}
