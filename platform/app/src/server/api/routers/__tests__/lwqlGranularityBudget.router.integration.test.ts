/**
 * @vitest-environment node
 *
 * The workbench door of the granularity bucket budget: the `analytics.lwql.query`
 * procedure carries the caller's step into the real service, and a window-step
 * pair past the ceiling is refused with the coded arithmetic before anything
 * reaches a database.
 *
 * Unlike the feature-switch suite beside it, the LangWatchQL service is NOT
 * mocked here — the refusal under test IS the service's decision, and a stub
 * would agree with whatever it was told. What is faked is everything around it:
 * the flag, RBAC, the protections resolver and the Prisma client. No ClickHouse
 * is needed: the refusal fires before the availability check, so the
 * unprovisioned singleton answers the control case below rather than a
 * database.
 *
 * Spec: packages/features/analytics/specs/analytics-lwql-workbench.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";

const { mockFeatureFlagIsEnabled } = vi.hoisted(() => ({
  mockFeatureFlagIsEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock("~/runtime/app/features/audit-log", () => ({
  auditLog: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    resolveProjectPermission: vi
      .fn()
      .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" }),
  };
});

vi.mock("../../utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils")>();
  return {
    ...actual,
    getUserProtectionsForProject: vi.fn().mockResolvedValue({
      canSeeCapturedInput: true,
      canSeeCapturedOutput: true,
      canSeeCosts: true,
    }),
  };
});

import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { createTestApp } from "~/server/app-layer/presets";
import { lwqlRouter } from "../analytics";

wireDefaultTestApp();

const PROJECT_ID = "proj_granularity_budget_test";

const mockPrismaClient = {
  project: {
    findUnique: vi.fn().mockResolvedValue({
      id: PROJECT_ID,
      lwqlKey: "sk-lw-lwql-granularity-budget-test-key",
      team: { organizationId: "org_granularity_budget_test" },
    }),
  },
} as any;

function createCaller() {
  const app = createTestApp({
    featureFlags: {
      isEnabled: mockFeatureFlagIsEnabled,
    } as unknown as FeatureFlagService,
  });
  return lwqlRouter.createCaller({
    session: { user: { id: "user_test_123" }, expires: "2099-01-01" },
    app,
    req: undefined,
    res: undefined,
    prisma: mockPrismaClient,
    permissionChecked: false,
    publiclyShared: false,
    organizationRole: undefined,
  } as any);
}

/** Declares the granularity parameter alongside both reserved period bounds. */
const GRANULARITY_SQL =
  "SELECT toStartOfInterval(OccurredAt, INTERVAL {period_granularity_seconds:UInt32} SECOND) AS bucket, " +
  "count() AS value FROM analytics.traces " +
  "WHERE OccurredAt >= {period_start:DateTime} AND OccurredAt < {period_end:DateTime} " +
  "GROUP BY bucket ORDER BY bucket";

/** Seven days, in seconds — the window the request reports over. */
const WEEK_SECONDS = 7 * 24 * 3600;
const WEEK = {
  start: new Date("2026-02-20T00:00:00.000Z"),
  end: new Date("2026-02-27T00:00:00.000Z"),
};

/** The tRPC-wrapped handled error's cause: the original HandledError itself. */
async function causeOf(run: () => Promise<unknown>): Promise<{
  code?: unknown;
  meta?: Record<string, unknown>;
}> {
  try {
    await run();
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause ?? error;
    return {
      code: (cause as { code?: unknown }).code,
      meta: (cause as { meta?: Record<string, unknown> }).meta,
    };
  }
  throw new Error("expected the query to be refused, but it succeeded");
}

describe("given the workbench query procedure and the granularity budget", () => {
  let caller: ReturnType<typeof createCaller>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaClient.project.findUnique.mockResolvedValue({
      id: PROJECT_ID,
      lwqlKey: "sk-lw-lwql-granularity-budget-test-key",
      team: { organizationId: "org_granularity_budget_test" },
    });
    caller = createCaller();
  });

  describe("when a statement declaring the parameter is run at one-second steps over a week", () => {
    /** @scenario "A window that would produce more buckets than the ceiling refuses on the workbench and REST" */
    it("is refused with the named code and the bucket arithmetic in its meta", async () => {
      const refusal = await causeOf(() =>
        caller.query({
          projectId: PROJECT_ID,
          sql: GRANULARITY_SQL,
          timeWindow: WEEK,
          granularitySeconds: 1,
        }),
      );

      // By code, never by prose: the code is the contract every client keys on.
      expect(refusal.code).toBe("lwql_granularity_too_fine");
      expect(refusal.meta).toMatchObject({
        requestedGranularitySeconds: 1,
        windowSeconds: WEEK_SECONDS,
        maxBuckets: 10_000,
      });
    });
  });

  describe("when the same statement is run at an hour, which fits the ceiling", () => {
    it("gets past the budget gate and reaches the next gate instead", async () => {
      // This deployment provisions no LangWatchQL identity, so the honest
      // answer past the budget gate is unavailability — proving the refusal
      // above was about the budget and not about the door.
      const refusal = await causeOf(() =>
        caller.query({
          projectId: PROJECT_ID,
          sql: GRANULARITY_SQL,
          timeWindow: WEEK,
          granularitySeconds: 3600,
        }),
      );

      expect(refusal.code).toBe("lwql_unavailable");
    });
  });
});
