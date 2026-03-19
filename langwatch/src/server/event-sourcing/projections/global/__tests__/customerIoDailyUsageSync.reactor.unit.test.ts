import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NurturingService } from "../../../../../../ee/billing/nurturing/nurturing.service";
import type { ProjectService } from "../../../../app-layer/projects/project.service";
import type { ReactorContext } from "../../../reactors/reactor.types";
import type { Event } from "../../../domain/types";
import type { ProjectDailySdkUsageState } from "../projectDailySdkUsage.store";
import {
  createCustomerIoDailyUsageSyncReactor,
  type CustomerIoDailyUsageSyncReactorDeps,
} from "../customerIoDailyUsageSync.reactor";

// Suppress logger output
vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

function createFoldState(
  overrides: Partial<ProjectDailySdkUsageState> = {},
): ProjectDailySdkUsageState {
  return {
    projectId: "project-1",
    date: "2026-03-15",
    sdkName: "langwatch-python",
    sdkVersion: "1.0.0",
    sdkLanguage: "python",
    count: 1,
    lastEventTimestamp: Date.now(),
    ...overrides,
  };
}

function createEvent(tenantId = "project-1"): Event {
  return {
    id: "event-1",
    aggregateId: `project-1:2026-03-15:langwatch-python:1.0.0:python`,
    aggregateType: "global",
    tenantId,
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.obs.trace.span_received",
    version: 1,
    data: {},
    metadata: {},
  } as unknown as Event;
}

function createContext(
  foldState: ProjectDailySdkUsageState,
): ReactorContext<ProjectDailySdkUsageState> {
  return {
    tenantId: foldState.projectId,
    aggregateId: `${foldState.projectId}:${foldState.date}:${foldState.sdkName}:${foldState.sdkVersion}:${foldState.sdkLanguage}`,
    foldState,
  };
}

function createMockNurturing(): NurturingService {
  return {
    identifyUser: vi.fn().mockResolvedValue(undefined),
    trackEvent: vi.fn().mockResolvedValue(undefined),
    groupUser: vi.fn().mockResolvedValue(undefined),
    batch: vi.fn().mockResolvedValue(undefined),
  } as unknown as NurturingService;
}

function createDeps(
  overrides: Partial<CustomerIoDailyUsageSyncReactorDeps> = {},
): CustomerIoDailyUsageSyncReactorDeps {
  return {
    projects: {
      resolveOrgAdmin: vi.fn().mockResolvedValue({
        userId: "user-1",
        organizationId: "org-1",
        firstMessage: false,
      }),
    } as unknown as ProjectService,
    prisma: {
      projectDailySdkUsage: {
        aggregate: vi.fn().mockResolvedValue({
          _sum: { count: 150 },
        }),
        findMany: vi.fn().mockResolvedValue([
          { count: 42 },
        ]),
      },
    } as any,
    nurturing: createMockNurturing(),
    ...overrides,
  };
}

describe("customerIoDailyUsageSync reactor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("makeJobId", () => {
    it("returns cio-daily-usage-{tenantId}", () => {
      const deps = createDeps();
      const reactor = createCustomerIoDailyUsageSyncReactor(deps);
      const event = createEvent("project-42");

      const jobId = reactor.options!.makeJobId!({
        event,
        foldState: createFoldState(),
      });

      expect(jobId).toBe("cio-daily-usage-project-42");
    });
  });

  describe("given the projectDailySdkUsage fold has completed for a project", () => {
    describe("when the daily usage sync reactor runs", () => {
      it("identifies user with trace_count as cumulative total", async () => {
        const deps = createDeps();
        const reactor = createCustomerIoDailyUsageSyncReactor(deps);
        const state = createFoldState();

        await reactor.handle(createEvent(), createContext(state));

        expect(deps.nurturing.identifyUser).toHaveBeenCalledWith({
          userId: "user-1",
          traits: expect.objectContaining({
            trace_count: 150,
          }),
        });
      });

      it("includes daily_trace_count from today", async () => {
        const deps = createDeps();
        const reactor = createCustomerIoDailyUsageSyncReactor(deps);
        const state = createFoldState();

        await reactor.handle(createEvent(), createContext(state));

        expect(deps.nurturing.identifyUser).toHaveBeenCalledWith({
          userId: "user-1",
          traits: expect.objectContaining({
            daily_trace_count: 42,
          }),
        });
      });

      it("includes trace_count_updated_at as ISO 8601 timestamp", async () => {
        const deps = createDeps();
        const reactor = createCustomerIoDailyUsageSyncReactor(deps);
        const state = createFoldState();

        await reactor.handle(createEvent(), createContext(state));

        expect(deps.nurturing.identifyUser).toHaveBeenCalledWith({
          userId: "user-1",
          traits: expect.objectContaining({
            trace_count_updated_at: expect.stringMatching(
              /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
            ),
          }),
        });
      });
    });
  });

  describe("given the project is not found", () => {
    it("does not call nurturing methods", async () => {
      const deps = createDeps({
        projects: {
          resolveOrgAdmin: vi.fn().mockResolvedValue({
            userId: null,
            organizationId: null,
            firstMessage: false,
          }),
        } as any,
      });
      const reactor = createCustomerIoDailyUsageSyncReactor(deps);

      await reactor.handle(
        createEvent(),
        createContext(createFoldState()),
      );

      expect(deps.nurturing.identifyUser).not.toHaveBeenCalled();
    });
  });

  describe("given the nurturing service throws", () => {
    it("does not propagate the error", async () => {
      const nurturing = createMockNurturing();
      vi.mocked(nurturing.identifyUser).mockRejectedValue(
        new Error("CIO down"),
      );
      const deps = createDeps({ nurturing });
      const reactor = createCustomerIoDailyUsageSyncReactor(deps);

      await expect(
        reactor.handle(createEvent(), createContext(createFoldState())),
      ).resolves.toBeUndefined();
    });
  });

  describe("when cumulative total is zero", () => {
    it("sends trace_count as 0", async () => {
      const deps = createDeps({
        prisma: {
          project: {
            findUnique: vi.fn().mockResolvedValue({
              id: "project-1",
              team: {
                organization: {
                  members: [{ userId: "user-1", role: "ADMIN" }],
                },
              },
            }),
          },
          projectDailySdkUsage: {
            aggregate: vi.fn().mockResolvedValue({ _sum: { count: null } }),
            findMany: vi.fn().mockResolvedValue([]),
          },
        } as any,
      });
      const reactor = createCustomerIoDailyUsageSyncReactor(deps);

      await reactor.handle(
        createEvent(),
        createContext(createFoldState()),
      );

      expect(deps.nurturing.identifyUser).toHaveBeenCalledWith({
        userId: "user-1",
        traits: expect.objectContaining({
          trace_count: 0,
          daily_trace_count: 0,
        }),
      });
    });
  });
});
