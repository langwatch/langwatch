/**
 * ADR-057 — the `sharedTrace.get` router assembly itself.
 *
 * The share-safe gates and `ShareService.resolveForViewer` are unit-tested in
 * isolation; this harness proves the router actually WIRES them: the token is
 * resolved exactly once, protections are fetched as a public-share read, the
 * gates are applied to the assembled DTO (no cost, no evaluator inputs or
 * stacktraces), and a THREAD-typed share resolves to the same generic
 * not-found as a bad token. A refactor that dropped a gate call would keep
 * every isolated gate test green — only this suite catches it.
 *
 * Mirrors the traces.4991-full-resolution.unit.test.ts harness (createCaller +
 * mocked app layer + mocked utils).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SHARE_MAX_FULL_SPANS } from "../sharedTrace.schemas";
import type { PrismaClient } from "@prisma/client";
import { createInnerTRPCContext } from "../../trpc";
import { sharedTraceRouter } from "../sharedTrace";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockResolveForViewer,
  mockProjectsGetById,
  mockSummaryGetByTraceId,
  mockGetSpanSummaryByTraceId,
  mockGetSpansByTraceId,
  mockGetLangwatchSignalsByTraceId,
  mockGetSpanResourcesByTraceId,
  mockGetTraceEventsByTraceId,
  mockGetEvaluationsMultiple,
  mockGetUserProtectionsForProject,
  mockRateLimit,
} = vi.hoisted(() => ({
  mockResolveForViewer: vi.fn(),
  mockProjectsGetById: vi.fn(),
  mockSummaryGetByTraceId: vi.fn(),
  mockGetSpanSummaryByTraceId: vi.fn(),
  mockGetSpansByTraceId: vi.fn(),
  mockGetLangwatchSignalsByTraceId: vi.fn(),
  mockGetSpanResourcesByTraceId: vi.fn(),
  mockGetTraceEventsByTraceId: vi.fn(),
  mockGetEvaluationsMultiple: vi.fn(),
  mockGetUserProtectionsForProject: vi.fn(),
  mockRateLimit: vi.fn(),
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    share: { resolveForViewer: mockResolveForViewer },
    // No cache in unit tests: every call assembles, so the assertions below
    // observe the real assembly rather than a replayed payload.
    sharedTraceCache: {
      get: async () => null,
      set: async () => undefined,
    },
    projects: { getById: mockProjectsGetById },
    traces: {
      summary: { getByTraceId: mockSummaryGetByTraceId },
      spans: {
        getSpanSummaryByTraceId: mockGetSpanSummaryByTraceId,
        getSpansByTraceId: mockGetSpansByTraceId,
        getLangwatchSignalsByTraceId: mockGetLangwatchSignalsByTraceId,
        getSpanResourcesByTraceId: mockGetSpanResourcesByTraceId,
        getTraceEventsByTraceId: mockGetTraceEventsByTraceId,
      },
    },
  }),
}));

vi.mock("~/server/traces/trace.service", () => ({
  TraceService: {
    create: () => ({ getEvaluationsMultiple: mockGetEvaluationsMultiple }),
  },
}));

vi.mock("../../utils", () => ({
  getUserProtectionsForProject: mockGetUserProtectionsForProject,
}));

vi.mock("~/server/rateLimit", () => ({ rateLimit: mockRateLimit }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const PROJECT_ID = "project_1";
const TRACE_ID = "trace_a";
const TOKEN = "tok_abc";

/** What an anonymous viewer of a public link gets: no spend, no content. */
const anonProtections = {
  canSeeCosts: false,
  canSeeCapturedInput: false,
  canSeeCapturedOutput: false,
  visibilityCutoffMs: null,
};

function buildResolvedShare(overrides: Record<string, unknown> = {}) {
  return {
    id: "share_1",
    token: TOKEN,
    resourceType: "TRACE",
    resourceId: TRACE_ID,
    projectId: PROJECT_ID,
    visibility: "PUBLIC",
    maxViews: null,
    viewCount: 1,
    ...overrides,
  };
}

/** Minimal-but-real TraceSummaryData for the actual header mapper. */
const summaryFixture = {
  traceId: TRACE_ID,
  occurredAt: 1_700_000_000_000,
  attributes: {} as Record<string, string>,
  totalDurationMs: 120,
  spanCount: 2,
  errorMessage: null,
  computedInput: "what is the launch code?",
  computedOutput: "1234",
  redactedByVisibilityWindow: false,
  models: [],
  totalCost: 1.23,
  nonBilledCost: null,
  totalPromptTokenCount: 10,
  totalCompletionTokenCount: 5,
  tokensEstimated: false,
  timeToFirstTokenMs: null,
  // Non-nullable in `traceSummaryDataSchema` — the share payload's output
  // parser enforces that contract, so the fixture has to honour it too.
  traceName: "checkout-agent",
  rootSpanType: null,
  containsPrompt: false,
  selectedPromptId: null,
  selectedPromptSpanId: null,
  lastUsedPromptId: null,
  lastUsedPromptVersionNumber: null,
  lastUsedPromptVersionId: null,
  lastUsedPromptSpanId: null,
};

/** Minimal-but-real `Span` the actual detail mapper can consume. */
function buildSpanFixture(index: number) {
  return {
    span_id: `span_${index}`,
    parent_id: null,
    trace_id: TRACE_ID,
    name: "step",
    type: "span",
    input: null,
    output: null,
    error: null,
    metrics: null,
    params: null,
    timestamps: { started_at: index, finished_at: index + 1 },
  };
}

const evaluationFixture = {
  evaluation_id: "eval_1",
  evaluator_id: "ev_check",
  name: "Faithfulness",
  status: "processed",
  passed: false,
  score: 0.2,
  details: 'The answer "the launch code is 1234" is not grounded.',
  inputs: { input: "what is the launch code?", output: "1234" },
  error: {
    has_error: true,
    message: "evaluator crashed on output: 1234",
    stacktrace: ["at scorer.py:42"],
  },
  timestamps: {},
};

function createAnonymousCaller() {
  const ctx = createInnerTRPCContext({
    session: null,
    req: undefined,
    res: undefined,
  });
  ctx.prisma = {} as unknown as PrismaClient;
  return sharedTraceRouter.createCaller(ctx);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveForViewer.mockResolvedValue(buildResolvedShare());
  mockProjectsGetById.mockResolvedValue({
    name: "Acme",
    slug: "acme",
    language: "python",
    framework: "openai",
  });
  mockSummaryGetByTraceId.mockResolvedValue(summaryFixture);
  mockGetSpanSummaryByTraceId.mockResolvedValue([]);
  mockGetSpansByTraceId.mockResolvedValue([]);
  mockGetLangwatchSignalsByTraceId.mockResolvedValue([]);
  mockGetSpanResourcesByTraceId.mockResolvedValue([]);
  mockGetTraceEventsByTraceId.mockResolvedValue([]);
  mockGetEvaluationsMultiple.mockResolvedValue({
    [TRACE_ID]: [evaluationFixture],
  });
  mockGetUserProtectionsForProject.mockResolvedValue(anonProtections);
  mockRateLimit.mockResolvedValue({ allowed: true, remaining: 10, resetAt: 0 });
});

describe("sharedTrace.get", () => {
  describe("given a valid public TRACE share and an anonymous viewer", () => {
    /** @scenario One viewing session counts as a single view */
    /** @scenario One page load counts as one view */
    it("resolves the token exactly once, via the service", async () => {
      await createAnonymousCaller().get({ token: TOKEN });

      expect(mockResolveForViewer).toHaveBeenCalledTimes(1);
      expect(mockResolveForViewer).toHaveBeenCalledWith(
        expect.objectContaining({ token: TOKEN }),
      );
    });

    /** @scenario A shared view cannot see beyond the project's data-retention window */
    it("fetches protections as a public-share read", async () => {
      await createAnonymousCaller().get({ token: TOKEN });

      expect(mockGetUserProtectionsForProject).toHaveBeenCalledWith(
        expect.objectContaining({ publiclyShared: true }),
        { projectId: PROJECT_ID },
      );
    });

    it("assembles a DTO with spend stripped from the header", async () => {
      const dto = await createAnonymousCaller().get({ token: TOKEN });

      expect(dto.header.traceId).toBe(TRACE_ID);
      expect(dto.header.totalCost).toBeNull();
    });

    it("redacts captured content off the header for a content-hidden viewer", async () => {
      const dto = await createAnonymousCaller().get({ token: TOKEN });

      expect(dto.header.input).toBeNull();
      expect(dto.header.output).toBeNull();
      expect(dto.header.inputRedacted).toBe(true);
    });

    it("gates the evaluator verdicts: no inputs, no details, no stacktrace", async () => {
      const dto = await createAnonymousCaller().get({ token: TOKEN });

      expect(dto.evaluations).toHaveLength(1);
      expect(dto.evaluations[0]?.passed).toBe(false);
      // Absent, not merely undefined: the output schema omits `inputs` from
      // the share contract entirely, so the key never reaches the wire.
      expect(dto.evaluations[0]).not.toHaveProperty("inputs");
      expect(dto.evaluations[0]?.details).toBeNull();
      expect(dto.evaluations[0]?.error?.stacktrace).toEqual([]);
    });

    it("exposes only the project chrome fields", async () => {
      const dto = await createAnonymousCaller().get({ token: TOKEN });

      expect(dto.project).toEqual({
        id: PROJECT_ID,
        name: "Acme",
        slug: "acme",
        language: "python",
        framework: "openai",
      });
    });
  });

  describe("given the share surface is being read far too often", () => {
    /** @scenario Opening a shared link too often is refused for a moment */
    it("refuses the read without touching the trace stores", async () => {
      mockRateLimit.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetAt: 0,
      });

      await expect(
        createAnonymousCaller().get({ token: TOKEN }),
      ).rejects.toThrow(/too often/i);
      // Refused before any work: the point of the limit is that an abusive
      // caller cannot drive the analytics reads at all.
      expect(mockResolveForViewer).not.toHaveBeenCalled();
      expect(mockSummaryGetByTraceId).not.toHaveBeenCalled();
    });
  });

  describe("given a trace that belongs to a conversation", () => {
    /** @scenario A shared link never reveals the surrounding conversation */
    it("carries no conversation in the payload", async () => {
      const dto = await createAnonymousCaller().get({ token: TOKEN });

      expect(dto).not.toHaveProperty("conversation");
    });
  });

  describe("given a trace with more spans than one share payload may carry", () => {
    /**
     * The endpoint is unauthenticated, so a wide trace must not assemble every
     * span's captured content into one unbounded response. The waterfall stays
     * complete; only per-span detail stops, and the payload says so.
     */
    /** @scenario A very large trace shares its timeline without every step's detail */
    it("caps the span detail and flags the truncation", async () => {
      mockGetSpansByTraceId.mockResolvedValue(
        Array.from({ length: SHARE_MAX_FULL_SPANS + 25 }, (_, i) =>
          buildSpanFixture(i),
        ),
      );

      const dto = await createAnonymousCaller().get({ token: TOKEN });

      expect(dto.spansFull).toHaveLength(SHARE_MAX_FULL_SPANS);
      expect(dto.isSpanDetailTruncated).toBe(true);
    });
  });

  describe("given a trace that fits within the span-detail cap", () => {
    it("carries every span and does not flag truncation", async () => {
      mockGetSpansByTraceId.mockResolvedValue(
        Array.from({ length: 3 }, (_, i) => buildSpanFixture(i)),
      );

      const dto = await createAnonymousCaller().get({ token: TOKEN });

      expect(dto.spansFull).toHaveLength(3);
      expect(dto.isSpanDetailTruncated).toBe(false);
    });
  });

  describe("given a content-visible viewer (public data-privacy policy)", () => {
    it("keeps evaluator details but still never inputs or stacktraces", async () => {
      mockGetUserProtectionsForProject.mockResolvedValue({
        ...anonProtections,
        canSeeCapturedInput: true,
        canSeeCapturedOutput: true,
      });

      const dto = await createAnonymousCaller().get({ token: TOKEN });

      expect(dto.evaluations[0]?.details).toContain("not grounded");
      expect(dto.evaluations[0]).not.toHaveProperty("inputs");
      expect(dto.evaluations[0]?.error?.stacktrace).toEqual([]);
    });
  });

  describe("given the token resolves to a THREAD-typed share", () => {
    it("answers with the same generic not-found as a bad token", async () => {
      mockResolveForViewer.mockResolvedValue(
        buildResolvedShare({ resourceType: "THREAD" }),
      );

      await expect(
        createAnonymousCaller().get({ token: TOKEN }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        message: "This share link is not available.",
      });
      // Nothing trace-shaped is read for a share the viewer can't render.
      expect(mockSummaryGetByTraceId).not.toHaveBeenCalled();
    });
  });
});
