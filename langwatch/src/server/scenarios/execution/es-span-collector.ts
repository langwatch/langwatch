/**
 * Collects spans from Elasticsearch for judge evaluation in HTTP scenario targets.
 *
 * Queries ES by trace ID, filters out scenario infrastructure spans,
 * converts LangWatch spans to ReadableSpan format, and populates a
 * JudgeSpanCollector instance for the judge agent.
 *
 * Retries with backoff since spans arrive asynchronously from the user's
 * OTEL SDK pipeline.
 */

import { JudgeSpanCollector } from "@langwatch/scenario";
import type { Attributes } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { createLogger } from "~/utils/logger/server";
import type { Span } from "../../tracer/types";
import { langwatchSpanToReadableSpan } from "../../tracer/spanToReadableSpan";
import { createSyntheticErrorSpan } from "./synthetic-error-span";
import type { SpanQueryFn } from "./types";

const logger = createLogger("EsSpanCollector");

/** Spans with these attributes are scenario infrastructure, not user agent spans */
const INFRASTRUCTURE_SPAN_PREFIXES = [
  "langwatch.scenario.",
  "langwatch.judge.",
  "langwatch.user_simulator.",
];

/**
 * The JudgeSpanCollector groups spans by thread ID using this attribute.
 * We must tag ES spans with it so getSpansForThread() can find them.
 */
const LANGWATCH_THREAD_ID_ATTR = "langwatch.thread.id";

interface CollectSpansParams {
  traceId: string;
  projectId: string;
  threadId: string;
  querySpans: SpanQueryFn;
  timeoutMs?: number;
  retryIntervalMs?: number;
}

/**
 * Queries ES for spans matching the given trace ID and populates
 * a JudgeSpanCollector. Retries until spans are found or timeout.
 *
 * Returns a JudgeSpanCollector pre-populated with the collected spans.
 */
export async function collectSpansFromEs({
  traceId,
  projectId,
  threadId,
  querySpans,
  timeoutMs = 10_000,
  retryIntervalMs = 1_000,
}: CollectSpansParams): Promise<JudgeSpanCollector> {
  const collector = new JudgeSpanCollector();

  try {
    const spans = await queryWithRetry({
      traceId,
      projectId,
      querySpans,
      timeoutMs,
      retryIntervalMs,
    });

    const userSpans = filterUserAgentSpans(spans);
    const readableSpans = userSpans.map(langwatchSpanToReadableSpan);
    const taggedSpans = tagSpansWithThreadId(readableSpans, threadId);
    populateCollector(collector, taggedSpans);

    logger.info(
      { traceId, totalSpans: spans.length, userSpans: userSpans.length },
      "Span collection complete",
    );
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : String(error);
    logger.warn({ traceId, error: reason }, "ES span query failed");

    const errorSpan = createSyntheticErrorSpan({
      traceId,
      reason,
    });
    const taggedErrorSpan = tagSpansWithThreadId([errorSpan], threadId);
    populateCollector(collector, taggedErrorSpan);
  }

  return collector;
}

async function queryWithRetry({
  traceId,
  projectId,
  querySpans,
  timeoutMs,
  retryIntervalMs,
}: {
  traceId: string;
  projectId: string;
  querySpans: SpanQueryFn;
  timeoutMs: number;
  retryIntervalMs: number;
}): Promise<Span[]> {
  const deadline = Date.now() + timeoutMs;
  let lastSpans: Span[] = [];

  while (Date.now() < deadline) {
    lastSpans = await querySpans({ projectId, traceId });

    if (lastSpans.length > 0) {
      return lastSpans;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;

    await sleep(Math.min(retryIntervalMs, remaining));
  }

  return lastSpans;
}

/**
 * Filters out scenario infrastructure spans, keeping only user agent spans.
 */
function filterUserAgentSpans(spans: Span[]): Span[] {
  return spans.filter((span) => {
    const name = span.name ?? "";
    return !INFRASTRUCTURE_SPAN_PREFIXES.some((prefix) =>
      name.startsWith(prefix),
    );
  });
}

/**
 * Populates a JudgeSpanCollector with pre-built ReadableSpan objects.
 * Uses the collector's onEnd method to add each span.
 */
function populateCollector(
  collector: JudgeSpanCollector,
  spans: ReadableSpan[],
): void {
  for (const span of spans) {
    collector.onEnd(span);
  }
}

/**
 * Tags ReadableSpan objects with the thread ID attribute so
 * JudgeSpanCollector.getSpansForThread() can find them.
 */
function tagSpansWithThreadId(
  spans: ReadableSpan[],
  threadId: string,
): ReadableSpan[] {
  return spans.map((span) => ({
    ...span,
    attributes: {
      ...span.attributes,
      [LANGWATCH_THREAD_ID_ATTR]: threadId,
    } as Attributes,
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
