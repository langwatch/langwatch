import { createApiFixture } from "@langwatch/api-fixture";
import type { RateLimitDecision } from "@langwatch/process-stores/members";
import type { ResolveShareInput, ShareApi, ShareWithProject } from "@langwatch/share-contract";
import {
  baseSpanSchema,
  SHARE_MAX_FULL_SPANS,
  TraceNotFoundError,
  type Protections,
  type Span,
  type TraceApi,
  type TraceSummaryData,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { traceReadMapperPorts } from "../../transport/api-trpc/trace-read-mapper-ports.ts";
import { TraceSharedReadService } from "../trace-shared-read.service.ts";

const PROJECT_ID = "project-1";
const TRACE_ID = "trace-1";

function summary(): TraceSummaryData {
  return {
    traceId: TRACE_ID,
    spanCount: 1,
    totalDurationMs: 10,
    computedIOSchemaVersion: "2025-12-18",
    computedInput: "the question",
    computedOutput: "the answer",
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: [],
    totalCost: 1.5,
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: 3,
    totalCompletionTokenCount: 4,
    outputFromRootSpan: true,
    outputSpanEndTimeMs: 10,
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
    attributes: { "langwatch.user_id": "end-user-7" },
    traceName: "a trace",
    occurredAt: 1_000,
    createdAt: 1_000,
    updatedAt: 1_000,
    LastEventOccurredAt: 1_000,
  };
}

function share(overrides: Partial<ShareWithProject> = {}): ShareWithProject {
  return {
    id: "share-1",
    token: "token-1",
    resourceType: "TRACE",
    resourceId: TRACE_ID,
    threadId: null,
    projectId: PROJECT_ID,
    userId: null,
    visibility: "PUBLIC",
    expiresAt: null,
    maxViews: null,
    viewCount: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    project: {
      traceSharingEnabled: true,
      team: { organizationId: "org-1", organization: { traceSharingEnabled: true } },
    },
    ...overrides,
  };
}

function span(index: number): Span {
  return baseSpanSchema.parse({
    span_id: `span-${index}`,
    trace_id: TRACE_ID,
    type: "span",
    timestamps: { started_at: 1_000, finished_at: 1_010 },
  });
}

type Setup = {
  resolved?: ShareWithProject | Error;
  archived?: boolean;
  missingTrace?: boolean;
  spans?: Span[];
  cached?: unknown;
  refuseKey?: string;
  canSeeCosts?: boolean;
};

function setup(options: Setup = {}) {
  const calls = {
    resolve: [] as ResolveShareInput[],
    protections: [] as { userId: string | undefined; publiclyShared: boolean }[],
    limitKeys: [] as string[],
    cached: [] as unknown[],
  };
  const protections: Protections = {
    canSeeCosts: options.canSeeCosts ?? false,
    canSeeCapturedInput: true,
    canSeeCapturedOutput: true,
    visibilityCutoffMs: null,
  };
  const reads = createApiFixture<TraceApi>({
    readTraceSummary: async () => {
      if (options.missingTrace) throw new TraceNotFoundError(TRACE_ID);
      return summary();
    },
    readSpanSummaries: async () => [],
    readSpans: async () => options.spans ?? [],
    readLangwatchSignals: async () => [],
    readSpanResources: async () => [],
    readTraceEvents: async () => [],
    readEvaluations: async () => ({}),
  });
  const shareApi = createApiFixture<ShareApi>({
    resolveForViewer: async (input) => {
      calls.resolve.push(input);
      const resolved = options.resolved ?? share();
      if (resolved instanceof Error) throw resolved;
      return resolved;
    },
    findCachedPayload: async () => options.cached,
    cachePayload: async ({ payload }) => {
      calls.cached.push(payload);
    },
  });
  const service = TraceSharedReadService.create({
    reads,
    share: shareApi,
    projects: {
      findById: async () => ({
        name: "Demo",
        slug: "demo",
        language: "python",
        framework: "openai",
        archivedAt: options.archived ? new Date(0) : null,
      }),
    },
    protections: {
      resolve: async (input) => {
        calls.protections.push({ userId: input.userId, publiclyShared: input.publiclyShared });
        return protections;
      },
    },
    rateLimiter: {
      check: async (key): Promise<RateLimitDecision> => {
        calls.limitKeys.push(key);
        return key === options.refuseKey
          ? { allowed: false, retryAfterSeconds: 30 }
          : { allowed: true };
      },
    },
    mappers: traceReadMapperPorts,
  });

  return { service, calls };
}

const ANONYMOUS = { token: "token-1", viewerUserId: null, clientIp: "10.0.0.1", userAgent: "ua" };

describe("TraceSharedReadService", () => {
  describe("when the link is opened too often", () => {
    /** @scenario Opening a shared link too often is refused for a moment */
    it("refuses once the token's window is spent, before the link is resolved", async () => {
      const { service, calls } = setup({ refuseKey: "sharedTrace:token:token-1" });

      await expect(service.getSharedTrace(ANONYMOUS)).rejects.toMatchObject({
        code: "share_read_rate_limited",
      });
      expect(calls.resolve).toHaveLength(0);
    });

    it("refuses once the caller's address window is spent", async () => {
      const { service } = setup({ refuseKey: "sharedTrace:ip:10.0.0.1" });

      await expect(service.getSharedTrace(ANONYMOUS)).rejects.toMatchObject({
        code: "share_read_rate_limited",
      });
    });

    it("counts per token only when no address is known", async () => {
      const { service, calls } = setup();

      await service.getSharedTrace({ ...ANONYMOUS, clientIp: null });

      expect(calls.limitKeys).toEqual(["sharedTrace:token:token-1"]);
      expect(calls.resolve[0]?.viewerKey).toBeUndefined();
    });
  });

  describe("when the share cannot be served", () => {
    it("passes the share module's refusal through unchanged", async () => {
      const refusal = Object.assign(new Error("forbidden"), { code: "share_link_forbidden" });
      const { service } = setup({ resolved: refusal });

      await expect(service.getSharedTrace(ANONYMOUS)).rejects.toBe(refusal);
    });

    it.each([
      ["a thread share", { resolved: share({ resourceType: "THREAD" }) }],
      ["an archived project", { archived: true }],
      ["a trace that no longer exists", { missingTrace: true }],
    ])("answers %s like a bad token", async (_case, options: Setup) => {
      const { service } = setup(options);

      await expect(service.getSharedTrace(ANONYMOUS)).rejects.toMatchObject({
        code: "share_link_not_found",
      });
    });
  });

  describe("when the link resolves", () => {
    it("resolves an anonymous caller as anonymous with public protections", async () => {
      const { service, calls } = setup();

      await service.getSharedTrace(ANONYMOUS);

      expect(calls.resolve[0]?.viewer).toEqual({ type: "anonymous" });
      expect(calls.resolve[0]?.viewerKey).toMatch(/^[0-9a-f]{32}$/);
      expect(calls.protections).toEqual([{ userId: undefined, publiclyShared: true }]);
    });

    it("resolves a signed-in caller as that user, so scoped links admit members", async () => {
      const { service, calls } = setup();

      await service.getSharedTrace({ ...ANONYMOUS, viewerUserId: "user-1" });

      expect(calls.resolve[0]?.viewer).toEqual({ type: "user", id: "user-1" });
      expect(calls.protections).toEqual([{ userId: "user-1", publiclyShared: true }]);
    });

    it("never discloses the end user behind the trace", async () => {
      const { service } = setup();

      const payload = await service.getSharedTrace(ANONYMOUS);

      expect(payload.header.userId).toBeNull();
      expect(payload.project).toEqual({
        id: PROJECT_ID,
        name: "Demo",
        slug: "demo",
        language: "python",
        framework: "openai",
      });
    });

    it("shows spend only to a viewer who may see it in-app", async () => {
      const hidden = await setup({ canSeeCosts: false }).service.getSharedTrace(ANONYMOUS);
      const shown = await setup({ canSeeCosts: true }).service.getSharedTrace(ANONYMOUS);

      expect(hidden.header.totalCost).toBeNull();
      expect(shown.header.totalCost).toBe(1.5);
    });

    /** @scenario A very large trace shares its timeline without every step's detail */
    it("caps per-span detail and says so", async () => {
      const spans = Array.from({ length: SHARE_MAX_FULL_SPANS + 1 }, (_, index) => span(index));
      const { service } = setup({ spans });

      const payload = await service.getSharedTrace(ANONYMOUS);

      expect(payload.isSpanDetailTruncated).toBe(true);
      expect(payload.spansFull).toHaveLength(SHARE_MAX_FULL_SPANS);
    });

    it("caches the built payload after authorization", async () => {
      const { service, calls } = setup();

      const payload = await service.getSharedTrace(ANONYMOUS);

      expect(calls.cached).toEqual([payload]);
    });

    it("rebuilds rather than replaying a cached entry today's contract rejects", async () => {
      const { service, calls } = setup({ cached: { stale: true } });

      await service.getSharedTrace(ANONYMOUS);

      expect(calls.cached).toHaveLength(1);
    });
  });
});
