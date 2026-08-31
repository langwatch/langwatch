import { createTenantId } from "@langwatch/eventing";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import Redis from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TraceQueryClassificationAdapter,
  type TraceSummaryRepository,
} from "@langwatch/trace-server";
import { AppTraceSummaryReaderAdapter } from "../trace";
import { createAppTraceSummaryStore } from "../../trace-summary-fold.adapter";

const summary: TraceSummaryData = {
  traceId: "trace-1",
  spanCount: 1,
  totalDurationMs: 100,
  computedIOSchemaVersion: "1",
  computedInput: "request",
  computedOutput: "response",
  timeToFirstTokenMs: null,
  timeToLastTokenMs: null,
  tokensPerSecond: null,
  containsErrorStatus: false,
  containsOKStatus: true,
  errorMessage: null,
  models: [],
  totalCost: null,
  nonBilledCost: null,
  tokensEstimated: false,
  totalPromptTokenCount: null,
  totalCompletionTokenCount: null,
  outputFromRootSpan: true,
  outputSpanEndTimeMs: 100,
  blockedByGuardrail: false,
  rootSpanType: null,
  containsAi: false,
  containsPrompt: false,
  selectedPromptId: null,
  selectedPromptSpanId: null,
  selectedPromptStartTimeMs: null,
  lastUsedPromptId: null,
  lastUsedPromptVersionNumber: null,
  lastUsedPromptVersionId: null,
  lastUsedPromptSpanId: null,
  lastUsedPromptStartTimeMs: null,
  topicId: null,
  subTopicId: null,
  annotationIds: [],
  attributes: {},
  traceName: "trace",
  occurredAt: 1,
  createdAt: 1,
  updatedAt: 2,
  LastEventOccurredAt: 2,
};

const redisClients: Redis[] = [];

function createRedisDouble(): Redis {
  const entries = new Map<string, string>();
  const redis = new Redis({ lazyConnect: true });
  vi.spyOn(redis, "get").mockImplementation(async (key) => entries.get(key) ?? null);
  vi.spyOn(redis, "set").mockImplementation(async (key, value) => {
    entries.set(key, String(value));
    return "OK";
  });
  redisClients.push(redis);
  return redis;
}

afterEach(() => {
  for (const redis of redisClients.splice(0)) redis.disconnect();
});

describe("Trace summary cache visibility", () => {
  it("serves the just-projected summary before the durable read becomes visible", async () => {
    const findByTraceId = vi.fn(async () => null);
    const repository = {
      upsert: vi.fn(async () => void 0),
      findByTraceId,
    } satisfies TraceSummaryRepository;
    const store = createAppTraceSummaryStore({
      repository,
      redis: createRedisDouble(),
      defaultRetentionDays: 30,
    });

    await store.store(summary, {
      aggregateId: summary.traceId,
      tenantId: createTenantId("project-1"),
    });

    const result = await AppTraceSummaryReaderAdapter.create(store).tryGetSummary({
      tenantId: "project-1",
      traceId: summary.traceId,
    });

    expect(result).toEqual(summary);
    expect(findByTraceId).not.toHaveBeenCalled();
  });
});

// The classifier that answers "does this query need the evaluations join?" moved
// into `@langwatch/trace-server` with the rest of query compilation (3f559ed6),
// and `AppTraceRuntime` composes the packaged one. This suite drives the same
// object the runtime does, so the grammar stays pinned where it now lives.
describe("Trace query classification", () => {
  const classifier = TraceQueryClassificationAdapter.create();

  it.each(["has:eval", 'has:"eval"', "none:eval", 'none:"eval"', "evaluatorVerdict:pass"])(
    "classifies %s through the canonical queryNeeds grammar",
    (query) => {
      expect(classifier.classify(query).evaluations).toBe(true);
    },
  );

  it("does not classify trace-only or invalid queries as evaluation reads", () => {
    expect(classifier.classify("status:error").evaluations).toBe(false);
    expect(classifier.classify("eval:score:evaluator_1").evaluations).toBe(false);
  });
});
