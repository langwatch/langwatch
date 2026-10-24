import type { Authorization } from "@langwatch/authorization";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { baseSpanSchema, type Span, type TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { braidedProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { readsBraidedSpans } from "../../rules/braided-span-owner.rules.ts";
import type { TraceAppDependencies } from "../trace.app.ts";
import { createTraceAppHarness } from "./support/trace-app.harness.ts";

const READER = "proj_orchestrator";
const OWNER = "proj_specialists";
const TRACE_ID = "trace-braided";

const span = (spanId: string): Span =>
  baseSpanSchema.parse({
    span_id: spanId,
    trace_id: TRACE_ID,
    type: "span",
    timestamps: { started_at: 1_000, finished_at: 1_010 },
  });

const summary: TraceSummaryData = {
  traceId: TRACE_ID,
  spanCount: 1,
  totalDurationMs: 10,
  computedIOSchemaVersion: "2025-12-18",
  computedInput: null,
  computedOutput: null,
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
  attributes: {},
  traceName: "a trace",
  occurredAt: 1_000,
  createdAt: 1_000,
  updatedAt: 1_000,
  LastEventOccurredAt: 1_000,
};

/** The readers stand in for the fence: an owner span is read only under a proof that
 *  carries a braid. */
function sharedApp() {
  const proofs: Authorization[] = [];
  const read =
    <T>(own: T, braided: T) =>
    async ({ authorization }: { authorization: Authorization }) => {
      proofs.push(authorization);
      return readsBraidedSpans(authorization) ? braided : own;
    };
  const app = createTraceAppHarness({
    authorizeRead: async ({ projectId }) => braidedProof({ projectId, braids: [{ owner: OWNER }] }),
    shareReadLimiter: { check: async () => ({ allowed: true }) },
    protections: createApiFixture<NonNullable<TraceAppDependencies["protections"]>>(
      {
        resolve: async () => ({
          canSeeCosts: true,
          canSeeCapturedInput: true,
          canSeeCapturedOutput: true,
          visibilityCutoffMs: null,
        }),
      },
      "protections",
    ),
    share: createApiFixture<TraceAppDependencies["share"]>(
      {
        resolveForViewer: async () =>
          ({
            resourceType: "TRACE",
            resourceId: TRACE_ID,
            projectId: READER,
            threadId: null,
          }) as never,
        findCachedPayload: async () => undefined,
        cachePayload: async () => {},
      },
      "share",
    ),
    projects: createApiFixture<TraceAppDependencies["projects"]>(
      {
        findById: async () =>
          ({ name: "Orchestrator", slug: "orchestrator", archivedAt: null }) as never,
        getOrganizationId: async () => "org_acme",
      },
      "projects",
    ),
    requestBounds: createApiFixture<TraceAppDependencies["requestBounds"]>(
      { requestBound: async () => 1_000 },
      "requestBounds",
    ),
    traces: {
      summary: createApiFixture<TraceAppDependencies["traces"]["summary"]>(
        { getByTraceId: read(summary, summary) },
        "summary",
      ),
      spans: createApiFixture<TraceAppDependencies["traces"]["spans"]>(
        {
          getSpanSummaryByTraceId: read([], []),
          getSpansByTraceId: read([span("own")], [span("own"), span("owner")]),
          getLangwatchSignalsByTraceId: read([], []),
          getSpanResourcesByTraceId: read([], []),
          getTraceEventsByTraceId: read([], []),
        },
        "spans",
      ),
      read: createApiFixture<TraceAppDependencies["traces"]["read"]>(
        { getEvaluationsMultiple: async () => ({}) },
        "read",
      ),
    },
  });
  return { app, proofs };
}

describe("a public share link of a trace holding braided spans", () => {
  describe("when the link is opened", () => {
    /** @scenario A public share link of a trace shows only the project's own spans */
    it("returns no owner span, since its proof carries no braid", async () => {
      const { app, proofs } = sharedApp();

      const shared = await app.getSharedTrace({
        token: "token-1",
        viewerUserId: null,
        clientIp: "10.0.0.1",
        userAgent: "ua",
      });

      expect(shared.spansFull.map((detail) => detail.spanId)).toEqual(["own"]);
      expect(proofs.length).toBeGreaterThan(1);
      expect(proofs.some(readsBraidedSpans)).toBe(false);
    });
  });
});
