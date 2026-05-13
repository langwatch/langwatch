import { tool } from "ai";
import { z } from "zod";
import { esClient, TRACE_INDEX } from "~/server/elasticsearch";
import { createLogger } from "~/utils/logger/server";
import type { LangyConversationContext } from "./types";

const logger = createLogger("langwatch:langy:tools:traces");

export function makeSearchTraces(ctx: LangyConversationContext) {
  return tool({
    description:
      "Keyword search over recent traces in this project (BM25 over input/output text and error messages — not semantic). Use when the user asks to 'find traces' with specific words or phrases in them ('error', 'timeout', a particular customer name). Returns a small list of trace ids with brief context. Tool result is per-turn only — do not persist or recall ids across conversations.",
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe("Free-text query (e.g. 'hallucinations', 'rag failures')."),
      limit: z.number().int().min(1).max(20).default(10),
    }),
    execute: async ({ query, limit }) => {
      try {
        const client = await esClient({ projectId: ctx.projectId });
        const result = await client.search({
          index: TRACE_INDEX.alias,
          size: limit,
          body: {
            query: {
              bool: {
                must: [
                  { term: { project_id: ctx.projectId } },
                  {
                    multi_match: {
                      query,
                      fields: [
                        "input.value^2",
                        "output.value",
                        "metadata.user_id",
                        "metadata.thread_id",
                        "error.message",
                      ],
                    },
                  },
                ],
              },
            },
            sort: [{ "timestamps.started_at": { order: "desc" } }],
          },
        });
        const hits = (result.hits?.hits ?? []) as Array<{
          _id: string;
          _source?: Record<string, unknown>;
        }>;
        return {
          items: hits.map((h) => ({
            traceId: h._id,
            startedAt:
              (
                h._source as
                  | { timestamps?: { started_at?: number } }
                  | undefined
              )?.timestamps?.started_at ?? null,
            snippet:
              (h._source as { input?: { value?: string } } | undefined)?.input
                ?.value?.slice(0, 200) ?? null,
          })),
        };
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : error },
          "search_traces failed",
        );
        return {
          items: [],
          error: "search_traces is unavailable right now.",
        };
      }
    },
  });
}
