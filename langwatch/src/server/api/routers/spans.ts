import { PublicShareResourceTypes } from "@prisma/client";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { checkPermissionOrPubliclyShared } from "../permission";
import { checkProjectPermission } from "../rbac";
import { getUserProtectionsForProject } from "../utils";
import { getTraceById, searchTraces } from "~/server/elasticsearch/traces";
import { TRPCError } from "@trpc/server";
import { TRACE_INDEX } from "~/server/elasticsearch";
import type { ChatMessage } from "~/server/tracer/types";
import { type LLMSpan } from "~/server/tracer/types";

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

      const trace = await getTraceById({
        connConfig: { projectId: input.projectId },
        traceId: input.traceId,
        protections,
        includeSpans: true,
      });
      if (!trace?.spans) {
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

      // Find the trace containing this span using nested query
      const traces = await searchTraces({
        connConfig: { projectId },
        protections,
        search: {
          index: TRACE_INDEX.all,
          size: 1,
          query: {
            bool: {
              filter: [
                { term: { project_id: projectId } },
                {
                  nested: {
                    path: "spans",
                    query: {
                      bool: {
                        must: [
                          { term: { "spans.span_id": spanId } },
                          { term: { "spans.type": "llm" } },
                        ],
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      });

      const trace = traces[0];

      if (!trace) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trace not found." });
      }

      const span = trace.spans?.find((s) => s.span_id === spanId);
      if (!span) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Span not found." });
      }

      if (span.type !== "llm") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Span is not an LLM span.",
        });
      }

      // Extract messages
      const messages: Array<ChatMessage> = [];

      if (
        span.input?.type === "chat_messages" &&
        Array.isArray(span.input.value)
      ) {
        messages.push(...span.input.value);
      }

      if (
        span.output?.type === "chat_messages" &&
        Array.isArray(span.output.value)
      ) {
        messages.push(...span.output.value);
      } else if (
        span.output?.type === "json" &&
        Array.isArray(span.output.value) &&
        span.output.value.length > 0 &&
        typeof span.output.value[0] === "string"
      ) {
        // If output type is json and it's an array of strings, treat first string as assistant reply
        messages.push({
          role: "assistant",
          content: span.output.value[0],
        });
      } else if (span.output?.value) {
        const content =
          typeof span.output.value === "string"
            ? span.output.value
            : JSON.stringify(span.output.value);
        messages.push({ role: "assistant", content });
      }

      // Extract LLM config
      const params = span.params ?? {};
      const systemPrompt = messages.find((m) => m.role === "system")?.content;
      const llmConfig = {
        model: (span as LLMSpan).model ?? null,
        systemPrompt,
        temperature: params.temperature ?? null,
        maxTokens: params.max_tokens ?? params.maxTokens ?? null,
        topP: params.top_p ?? params.topP ?? null,
        litellmParams: {} as Record<string, any>,
      };

      const excludeKeys = new Set([
        "temperature",
        "max_tokens",
        "maxTokens",
        "top_p",
        "topP",
        "_keys",
      ]);
      Object.entries(params).forEach(([key, value]) => {
        if (!excludeKeys.has(key)) {
          llmConfig.litellmParams[key] = value;
        }
      });

      return {
        spanId: span.span_id,
        traceId: trace.trace_id,
        spanName: span.name ?? null,
        messages,
        llmConfig,
        vendor: (span as LLMSpan).vendor ?? null,
        error: span.error ?? null,
        timestamps: span.timestamps,
        metrics: span.metrics ?? null,
      };
    }),
});
