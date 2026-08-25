/**
 * The evaluate boundary rebuilds a declined evaluation's response field by
 * field, so anything it does not name is dropped before the caller sees it.
 * The comparison judge pays for both of its passes before finding they
 * disagree, and that row reaches the SDK as `skipped`: dropping its cost there
 * is what left `EvaluationCost` null in ClickHouse for exactly the rows that
 * cost the most.
 *
 * spec: specs/experiments/comparison.feature
 *   - "An inconclusive row still reports what it cost"
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appContextMiddlewareFor } from "~/app/api/middleware/app-context";
import { getApp } from "~/server/app-layer/app";

const mockRunEvaluation = vi.fn();
vi.mock("~/server/evaluations/runEvaluation", () => ({
  runEvaluation: (...args: unknown[]) => mockRunEvaluation(...args),
}));

const mockResolve = vi.fn();
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

const mockCostCreate = vi.fn();
vi.mock("~/server/db", () => ({
  prisma: {
    monitor: { findUnique: vi.fn().mockResolvedValue(null) },
    evaluator: { findFirst: vi.fn().mockResolvedValue(null) },
    cost: { create: (...args: unknown[]) => mockCostCreate(...args) },
  },
}));

vi.mock("~/server/api/routers/evaluations", () => ({
  getCustomEvaluators: vi.fn().mockResolvedValue([]),
}));

vi.mock("~/server/modelProviders/modelDefaults.read", () => ({
  getResolvedDefaultForFeature: vi.fn().mockResolvedValue(null),
}));

const mockReportEvaluation = vi.fn().mockResolvedValue(undefined);
vi.mock("~/server/app-layer/app", async () => {
  // The app-context middleware reads tryGetApp, and the credential
  // middleware decides through the App's permissions (ADR-092), so the fake
  // carries both — permissions composed over this file's ~/server/db.
  const { appPermissionsService } = await import(
    "~/test-utils/appPermissionsMock"
  );
  const { prisma: dbForPermissions } = await import("~/server/db");
  const fakeApp = () => ({
    apiKeys: { tryResolveToken: mockResolve, markUsed: vi.fn() },
    permissions: appPermissionsService(dbForPermissions),
    evaluations: { reportEvaluation: mockReportEvaluation },
  });
  return { getApp: vi.fn(fakeApp), tryGetApp: vi.fn(fakeApp) };
});

const { app: evaluationsLegacyApp } = await import("../evaluations-legacy");

const testApp = new Hono();
testApp.use("*", appContextMiddlewareFor(getApp()));
testApp.route("/", evaluationsLegacyApp);

const INCONCLUSIVE_DETAILS =
  "Order-sensitive verdict: original order picked variant_1; reversed order picked variant_2.";

function evaluateComparison({
  guardrail = false,
}: {
  guardrail?: boolean;
} = {}) {
  return testApp.request(
    "http://localhost/api/evaluations/langevals/select_best_compare/evaluate",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-Token": "test-token",
      },
      body: JSON.stringify({
        name: "comparison",
        as_guardrail: guardrail,
        data: {
          input: "Name one colour of the sky at noon.",
          candidates: [
            { id: "variant_1", output: "Blue." },
            { id: "variant_2", output: "The sky is blue." },
          ],
          row_index: 3,
        },
        settings: { model: "openai/gpt-5-mini" },
      }),
    },
  );
}

describe("POST /api/evaluations/:evaluator/evaluate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockResolvedValue({
      type: "legacyProjectKey",
      project: {
        id: "project-123",
        apiKey: "test-token",
        team: { id: "team-1", organizationId: "org-1" },
      },
    });
    mockCostCreate.mockResolvedValue({ id: "cost-1" });
  });

  describe("given a judge that spent money and then declined to score", () => {
    beforeEach(() => {
      mockRunEvaluation.mockResolvedValue({
        status: "skipped",
        details: INCONCLUSIVE_DETAILS,
        cost: { currency: "USD", amount: 0.0021 },
      });
    });

    /** @scenario "An inconclusive row still reports what it cost" */
    it("answers with the cost the attempt incurred", async () => {
      const response = await evaluateComparison();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        status: "skipped",
        details: INCONCLUSIVE_DETAILS,
        cost: { currency: "USD", amount: 0.0021 },
      });
    });

    it("keeps the cost when the call gates on a guardrail boolean", async () => {
      const response = await evaluateComparison({ guardrail: true });

      await expect(response.json()).resolves.toEqual({
        status: "skipped",
        details: INCONCLUSIVE_DETAILS,
        cost: { currency: "USD", amount: 0.0021 },
        passed: true,
      });
    });
  });

  describe("given a judge that declined without spending anything", () => {
    beforeEach(() => {
      mockRunEvaluation.mockResolvedValue({
        status: "skipped",
        details: "N-way compare needs at least 2 candidates with output",
      });
    });

    it("answers with no cost at all rather than a zero", async () => {
      const response = await evaluateComparison();

      await expect(response.json()).resolves.toEqual({
        status: "skipped",
        details: "N-way compare needs at least 2 candidates with output",
      });
    });
  });

  describe("given a judge that picked a winner", () => {
    beforeEach(() => {
      mockRunEvaluation.mockResolvedValue({
        status: "processed",
        score: 1,
        label: "variant_1",
        details: "Confirmed under order swap.",
        cost: { currency: "USD", amount: 0.0013 },
      });
    });

    it("still answers with its cost", async () => {
      const response = await evaluateComparison();

      await expect(response.json()).resolves.toMatchObject({
        status: "processed",
        label: "variant_1",
        cost: { currency: "USD", amount: 0.0013 },
      });
    });
  });

  describe("given a judge that failed", () => {
    beforeEach(() => {
      mockRunEvaluation.mockResolvedValue({
        status: "error",
        error_type: "SomeInternalName",
        details: "the judge could not be reached",
        traceback: ["line one", "line two"],
      });
    });

    it("answers without a cost, and without the traceback", async () => {
      const response = await evaluateComparison();

      await expect(response.json()).resolves.toEqual({
        status: "error",
        error_type: "EVALUATOR_ERROR",
        details: "the judge could not be reached",
      });
    });
  });
});
