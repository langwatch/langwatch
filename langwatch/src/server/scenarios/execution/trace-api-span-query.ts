/**
 * Queries spans from the LangWatch trace API for use in the child process.
 *
 * The child process doesn't have direct ES/ClickHouse access, but it has
 * the LANGWATCH_ENDPOINT and LANGWATCH_API_KEY to call the platform API.
 * This module wraps the GET /api/trace/:traceId endpoint to retrieve spans.
 */

import { createLogger } from "~/utils/logger/server";
import type { Span } from "../../tracer/types";

const logger = createLogger("TraceApiSpanQuery");

interface TraceApiSpanQueryParams {
  endpoint: string;
  apiKey: string;
}

interface TraceApiResponse {
  trace_id: string;
  spans?: Span[];
}

/**
 * Creates a span query function that fetches spans via the LangWatch trace API.
 *
 * Returns a function compatible with the SpanQueryFn interface expected by
 * collectSpansFromEs and EsBackedJudgeAgent.
 */
export function createTraceApiSpanQuery({
  endpoint,
  apiKey,
}: TraceApiSpanQueryParams): (params: {
  projectId: string;
  traceId: string;
}) => Promise<Span[]> {
  return async ({ traceId }) => {
    const url = `${endpoint}/api/trace/${traceId}`;

    logger.debug({ url, traceId }, "Querying spans from trace API");

    const response = await fetch(url, {
      headers: {
        "x-auth-token": apiKey,
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (response.status === 404) {
      // Trace not found yet - spans may not have arrived
      return [];
    }

    if (!response.ok) {
      throw new Error(
        `Trace API returned ${response.status}: ${response.statusText}`,
      );
    }

    const data = (await response.json()) as TraceApiResponse;
    return data.spans ?? [];
  };
}
