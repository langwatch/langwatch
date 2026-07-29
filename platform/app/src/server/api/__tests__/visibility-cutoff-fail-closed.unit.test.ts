import { beforeEach, describe, expect, it, vi } from "vitest";

const { getActivePlanMock, resolveOrganizationIdMock, loggerErrorMock } =
  vi.hoisted(() => ({
    getActivePlanMock: vi.fn(),
    resolveOrganizationIdMock: vi.fn(),
    loggerErrorMock: vi.fn(),
  }));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: loggerErrorMock,
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ planProvider: { getActivePlan: getActivePlanMock } }),
}));

vi.mock("~/server/organizations/resolveOrganizationId", () => ({
  resolveOrganizationId: resolveOrganizationIdMock,
}));

vi.mock("~/server/data-privacy/dataPrivacyPolicy.service", () => ({
  getDataPrivacyPolicyService: vi.fn(),
}));

vi.mock("../rbac", () => ({
  hasProjectPermission: vi.fn(() => Promise.resolve(true)),
  isDemoProject: vi.fn(() => false),
}));

import { FREE_VISIBILITY_DAYS } from "../../../../ee/licensing/constants";
import { getVisibilityCutoffMsForProject } from "../utils";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The cutoff moves with `Date.now()`, so compare windows (now - cutoff) rather
 * than absolute instants, with a tolerance that swallows test execution time.
 */
const windowDaysOf = (cutoffMs: number): number =>
  (Date.now() - cutoffMs) / DAY_MS;

/** Unique per test: the plan lookup is cached in a module-level TTL cache. */
let projectCounter = 0;
const nextProjectId = () => `project_visibility_${++projectCounter}`;

describe("getVisibilityCutoffMsForProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveOrganizationIdMock.mockResolvedValue("organization_1");
  });

  describe("given plan resolution succeeds for a paid organization", () => {
    describe("when the cutoff is resolved", () => {
      it("applies no visibility window", async () => {
        getActivePlanMock.mockResolvedValue({ visibilityDays: null });

        await expect(
          getVisibilityCutoffMsForProject(nextProjectId()),
        ).resolves.toBeNull();
      });
    });
  });

  describe("given plan resolution throws", () => {
    describe("when the cutoff is resolved", () => {
      /**
       * Fail CLOSED. `null` here would mean "no window at all" — the LEAST
       * restrictive answer — and a plan-store blip would publish every
       * customer's full trace content. The catch must land on the free-tier
       * window instead, which is the MOST restrictive one we ever apply.
       *
       * @scenario Plan resolution failure fails closed
       */
      it("returns the free-tier window rather than no window", async () => {
        getActivePlanMock.mockRejectedValue(new Error("plan store down"));

        const cutoffMs = await getVisibilityCutoffMsForProject(nextProjectId());

        expect(cutoffMs).not.toBeNull();
        expect(windowDaysOf(cutoffMs!)).toBeCloseTo(FREE_VISIBILITY_DAYS, 3);
        expect(loggerErrorMock).toHaveBeenCalled();
      });

      it("never returns a window longer than the free tier", async () => {
        getActivePlanMock.mockResolvedValue({ visibilityDays: 365 });
        const generousCutoffMs = await getVisibilityCutoffMsForProject(
          nextProjectId(),
        );

        getActivePlanMock.mockRejectedValue(new Error("plan store down"));
        const failClosedCutoffMs = await getVisibilityCutoffMsForProject(
          nextProjectId(),
        );

        // A LATER cutoff hides MORE: everything started before it is teased.
        expect(failClosedCutoffMs!).toBeGreaterThan(generousCutoffMs!);
      });
    });

    describe("when the cutoff is resolved again after the store recovers", () => {
      it("does not pin the project to the free window", async () => {
        const projectId = nextProjectId();
        getActivePlanMock.mockRejectedValueOnce(new Error("plan store down"));

        const failClosedCutoffMs =
          await getVisibilityCutoffMsForProject(projectId);
        expect(windowDaysOf(failClosedCutoffMs!)).toBeCloseTo(
          FREE_VISIBILITY_DAYS,
          3,
        );

        getActivePlanMock.mockResolvedValue({ visibilityDays: null });

        await expect(
          getVisibilityCutoffMsForProject(projectId),
        ).resolves.toBeNull();
        expect(getActivePlanMock).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("given the project resolves to no organization", () => {
    describe("when the cutoff is resolved", () => {
      it("returns the free-tier window without consulting the plan provider", async () => {
        resolveOrganizationIdMock.mockResolvedValue(null);

        const cutoffMs = await getVisibilityCutoffMsForProject(nextProjectId());

        expect(cutoffMs).not.toBeNull();
        expect(windowDaysOf(cutoffMs!)).toBeCloseTo(FREE_VISIBILITY_DAYS, 3);
        expect(getActivePlanMock).not.toHaveBeenCalled();
        expect(loggerErrorMock).toHaveBeenCalled();
      });
    });
  });

  describe("given a real plan answer was already resolved for the project", () => {
    describe("when the cutoff is resolved again", () => {
      it("serves the plan from the cache instead of re-reading it", async () => {
        const projectId = nextProjectId();
        getActivePlanMock.mockResolvedValue({
          visibilityDays: FREE_VISIBILITY_DAYS,
        });

        const first = await getVisibilityCutoffMsForProject(projectId);
        const second = await getVisibilityCutoffMsForProject(projectId);

        expect(windowDaysOf(first!)).toBeCloseTo(FREE_VISIBILITY_DAYS, 3);
        expect(windowDaysOf(second!)).toBeCloseTo(FREE_VISIBILITY_DAYS, 3);
        expect(getActivePlanMock).toHaveBeenCalledTimes(1);
      });
    });
  });
});
