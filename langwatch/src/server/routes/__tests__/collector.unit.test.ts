import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── App-layer spies ──────────────────────────────────────────────────────────
// Captured at module scope so assertions can reach them from every it() block.
const mockIngestNormalizedSpan = vi.fn();
const mockReportEvaluation = vi.fn();
const mockCheckLimit = vi.fn();

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(() => ({
    usage: { checkLimit: mockCheckLimit },
    traces: { collection: { ingestNormalizedSpan: mockIngestNormalizedSpan } },
    evaluations: { reportEvaluation: mockReportEvaluation },
    planProvider: { getActivePlan: vi.fn() },
    usageLimits: { notifyPlanLimitReached: vi.fn() },
  })),
}));

// ─── Auth mocks ───────────────────────────────────────────────────────────────
// The route creates a module-scope tokenResolver = TokenResolver.create(prisma);
// mock the class so the singleton uses controllable mocks.
const mockResolve = vi.fn();
const mockMarkUsed = vi.fn();

vi.mock("~/server/api-key/token-resolver", () => ({
  TokenResolver: {
    create: vi.fn(() => ({
      resolve: mockResolve,
      markUsed: mockMarkUsed,
    })),
  },
}));

vi.mock("~/server/api-key/auth-middleware", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/server/api-key/auth-middleware")>();
  return {
    ...actual,
    extractCredentials: vi.fn(() => ({
      token: "test-token",
      projectId: "project-123",
    })),
    enforceApiKeyCeiling: vi.fn().mockResolvedValue(undefined),
  };
});

// ─── Infrastructure stubs ─────────────────────────────────────────────────────
vi.mock("~/server/db", () => ({
  prisma: {},
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  getCurrentScope: vi.fn(() => undefined),
}));

// ─── App under test ───────────────────────────────────────────────────────────
// Import AFTER all mocks so module-scope singletons pick up the mocked deps.
const { app: collectorApp } = await import("../collector");

const testApp = new Hono();
testApp.route("/", collectorApp);

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const fakeProject = {
  id: "project-123",
  teamId: "team-1",
  team: { id: "team-1", organizationId: "org-1" },
};

const NOW = Date.now();

function makeSpan(i: number, overrides: Record<string, unknown> = {}) {
  return {
    type: "span",
    span_id: `span-${i}`,
    trace_id: "trace-1",
    timestamps: { started_at: NOW - 1_000, finished_at: NOW },
    ...overrides,
  };
}

function postCollector(body: unknown) {
  return testApp.request("http://localhost/api/collector", {
    method: "POST",
    headers: {
      "X-Auth-Token": "test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/collector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockResolvedValue({
      type: "legacyProjectKey",
      project: fakeProject,
    });
    mockCheckLimit.mockResolvedValue({ exceeded: false });
    mockIngestNormalizedSpan.mockResolvedValue({ status: "collected" });
    mockReportEvaluation.mockResolvedValue(undefined);
  });

  describe("given a valid trace payload", () => {
    describe("when every span ingests successfully", () => {
      it("returns 200 with zero rejected spans", async () => {
        const res = await postCollector({
          trace_id: "trace-1",
          spans: [makeSpan(1), makeSpan(2)],
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.partialSuccess.rejectedSpans).toBe(0);
        expect(body.partialSuccess.rejectedEvaluations).toBe(0);
        expect(mockIngestNormalizedSpan).toHaveBeenCalledTimes(2);
      });
    });

    describe("when a span resolves as deduped", () => {
      it("counts deduped as success, not rejection", async () => {
        mockIngestNormalizedSpan
          .mockResolvedValueOnce({ status: "collected" })
          .mockResolvedValueOnce({ status: "deduped" });

        const res = await postCollector({
          trace_id: "trace-1",
          spans: [makeSpan(1), makeSpan(2)],
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.partialSuccess.rejectedSpans).toBe(0);
      });
    });
  });

  describe("given span ingestion failures", () => {
    describe("when some spans fail but others succeed", () => {
      it("returns 200 with the failed count in partialSuccess", async () => {
        mockIngestNormalizedSpan
          .mockResolvedValueOnce({ status: "collected" })
          .mockResolvedValueOnce({ status: "failed", error: "queue down" });

        const res = await postCollector({
          trace_id: "trace-1",
          spans: [makeSpan(1), makeSpan(2)],
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.partialSuccess.rejectedSpans).toBe(1);
        expect(body.partialSuccess.errorMessage).toContain("queue down");
      });
    });

    describe("when every span fails ingestion", () => {
      it("returns 500 naming the failure count so the SDK retries", async () => {
        mockIngestNormalizedSpan.mockResolvedValue({
          status: "failed",
          error: "redis unavailable",
        });

        const res = await postCollector({
          trace_id: "trace-1",
          spans: [makeSpan(1), makeSpan(2), makeSpan(3)],
        });

        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.message).toContain("3");
        expect(body.partialSuccess.rejectedSpans).toBe(3);
        expect(body.partialSuccess.errorMessage).toContain(
          "redis unavailable",
        );
      });
    });

    describe("when ingestNormalizedSpan rejects unexpectedly", () => {
      it("treats the rejection as a failure defensively", async () => {
        mockIngestNormalizedSpan.mockRejectedValue(new Error("boom"));

        const res = await postCollector({
          trace_id: "trace-1",
          spans: [makeSpan(1)],
        });

        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.partialSuccess.errorMessage).toContain("boom");
      });
    });
  });

  describe("given more than 200 spans", () => {
    describe("when the payload is dispatched", () => {
      it("returns 429 before ingesting anything", async () => {
        const spans = Array.from({ length: 201 }, (_, i) => makeSpan(i));

        const res = await postCollector({ trace_id: "trace-1", spans });

        expect(res.status).toBe(429);
        const body = await res.json();
        expect(body.message).toBe("Too many spans, maximum of 200 per trace");
        expect(mockIngestNormalizedSpan).not.toHaveBeenCalled();
      });
    });
  });

  describe("given more than 200 evaluations", () => {
    describe("when the payload is dispatched", () => {
      it("returns 429 before dispatching any evaluation", async () => {
        const evaluations = Array.from({ length: 201 }, (_, i) => ({
          name: `eval-${i}`,
          score: 1,
        }));

        const res = await postCollector({
          trace_id: "trace-1",
          spans: [makeSpan(1)],
          evaluations,
        });

        expect(res.status).toBe(429);
        const body = await res.json();
        expect(body.message).toBe(
          "Too many evaluations, maximum of 200 per trace",
        );
        expect(mockReportEvaluation).not.toHaveBeenCalled();
        expect(mockIngestNormalizedSpan).not.toHaveBeenCalled();
      });
    });
  });

  describe("given spans older than the 31-day ingestion window", () => {
    const OLD_STARTED_AT = NOW - 32 * 24 * 60 * 60 * 1000;

    describe("when an old span arrives alongside a fresh one", () => {
      it("drops only the old span and reports it as rejected", async () => {
        const res = await postCollector({
          trace_id: "trace-1",
          spans: [
            makeSpan(1, {
              timestamps: { started_at: OLD_STARTED_AT, finished_at: NOW },
            }),
            makeSpan(2),
          ],
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.partialSuccess.rejectedSpans).toBe(1);
        expect(body.partialSuccess.errorMessage).toContain("31 days");
        expect(mockIngestNormalizedSpan).toHaveBeenCalledTimes(1);
      });
    });

    describe("when every span is too old", () => {
      it("returns 200 (a policy drop, not an ingestion failure)", async () => {
        const res = await postCollector({
          trace_id: "trace-1",
          spans: [
            makeSpan(1, {
              timestamps: { started_at: OLD_STARTED_AT, finished_at: NOW },
            }),
          ],
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.partialSuccess.rejectedSpans).toBe(1);
        expect(mockIngestNormalizedSpan).not.toHaveBeenCalled();
      });
    });
  });

  describe("given multiple evaluations where one dispatch fails", () => {
    describe("when the first reportEvaluation throws", () => {
      it("continues dispatching the rest and reports the failure count", async () => {
        mockReportEvaluation
          .mockRejectedValueOnce(new Error("dispatch failed"))
          .mockResolvedValueOnce(undefined);

        const res = await postCollector({
          trace_id: "trace-1",
          spans: [makeSpan(1)],
          evaluations: [
            { name: "eval-a", score: 1 },
            { name: "eval-b", passed: true },
          ],
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(mockReportEvaluation).toHaveBeenCalledTimes(2);
        expect(body.partialSuccess.rejectedEvaluations).toBe(1);
        expect(body.partialSuccess.errorMessage).toContain("dispatch failed");
      });
    });
  });
});
