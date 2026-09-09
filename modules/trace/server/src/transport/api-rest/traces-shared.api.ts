/**
 * What every route in the v1 trace family shares: the context it runs on, the path and body
 * schemas, and the two error responses the reads publish. Split out of `traces.api.ts` so each
 * route group is its own module and the factory only names them in order.
 */
import { resolver, type EndpointVariables, type ProjectScopedContext } from "@langwatch/api/rest";
import { createLogger, type Logger } from "@langwatch/observability";
import type { ResponsesWithResolver } from "hono-openapi";
import { z } from "zod";

import { traceMetadataUpdateSchema } from "#services/trace-metadata-write.service";

export const logger: Logger = createLogger("langwatch:api:traces");

/** The handler context every route in this family runs on. */
export type TraceContext = ProjectScopedContext<EndpointVariables>;

export const traceIdParamsSchema = z.object({
  traceId: z
    .string()
    .min(1)
    .describe(
      "The trace ID — either the full 32-char ID or a unique prefix (≥ 8 chars). Prefix lookup is scoped to the authenticated project.",
    ),
});

export const traceFormatQuerySchema = z.object({
  format: z
    .string()
    .optional()
    .describe("Output format: 'digest' (AI-readable) or 'json' (full raw data, default)"),
  llmMode: z.string().optional().describe("Deprecated: use format=digest instead"),
});

export const traceMetadataBodySchema = z.object({ metadata: traceMetadataUpdateSchema });
export const traceMetadataResponseSchema = z.object({ traceId: z.string() });

export const transcriptResponseSchema = z.object({
  agent: z.string(),
  sessionId: z.string().nullable(),
  entries: z.array(z.object({}).passthrough()),
  totals: z.object({
    modelCalls: z.number(),
    toolCalls: z.number(),
    tokens: z.number(),
    costUsd: z.number(),
  }),
  subAgents: z.array(z.object({}).passthrough()),
});

export const traceNotFoundResponse: ResponsesWithResolver = {
  404: {
    description: "Trace not found",
    content: { "application/json": { schema: resolver(z.object({ message: z.string() })) } },
  },
};

export const ambiguousPrefixResponse: ResponsesWithResolver = {
  409: {
    description: "Ambiguous trace ID prefix — the prefix matches more than one trace",
    content: {
      "application/json": {
        schema: resolver(z.object({ message: z.string(), candidateTraceIds: z.array(z.string()) })),
      },
    },
  },
};

/**
 * A read that answers outside one success schema: `/search` streams its own
 * JSON so a large page is never buffered, and the two trace reads answer an
 * ambiguous-prefix 409 with the candidate ids beside the message.
 */
export const TRACE_ANSWER_REASON =
  "the search streams its envelope and the reads answer an ambiguous-prefix 409 of their own";
