/**
 * @vitest-environment node
 *
 * The three reads behind the in-depth automation view: the paginated firing
 * history, the alert's latest evaluation, and what the automation does next.
 *
 * Binds specs/automations/evaluation-visibility.feature at the API boundary —
 * the drawer tests bind the same feature at the surface.
 */
import { TriggerAction, TriggerKind } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalForApp } from "../../../app-layer/app";
import { createTestApp } from "../../../app-layer/presets";

const {
  mockTriggerFindUnique,
  mockTriggerSentFindMany,
  mockLatestEvaluationFindFirst,
  mockGetReportSchedules,
} = vi.hoisted(() => ({
  mockTriggerFindUnique: vi.fn(),
  mockTriggerSentFindMany: vi.fn(),
  mockLatestEvaluationFindFirst: vi.fn(),
  mockGetReportSchedules: vi.fn(),
}));

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    checkProjectPermission: vi.fn().mockImplementation(() => {
      return async ({ ctx, next }: any) =>
        next({ ctx: { ...ctx, permissionChecked: true } });
    }),
  };
});

import { PrismaTriggerRepository } from "../../../app-layer/automations/repositories/trigger.prisma.repository";
import { TriggerService } from "../../../app-layer/automations/trigger.service";
import { automationRouter } from "../automations";

const PROJECT_ID = "proj_view_1";
const TRIGGER_ID = "trigger_view_1";

const mockPrismaClient = {
  trigger: { findUnique: mockTriggerFindUnique },
  triggerSent: { findMany: mockTriggerSentFindMany },
  triggerLatestEvaluation: { findFirst: mockLatestEvaluationFindFirst },
} as any;

function createTestCaller() {
  return automationRouter.createCaller({
    session: { user: { id: "user_view_1" }, expires: "2099-01-01" },
    req: undefined,
    res: undefined,
    prisma: mockPrismaClient,
    permissionChecked: false,
    publiclyShared: false,
    organizationRole: undefined,
  } as any);
}

function traceAutomationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TRIGGER_ID,
    projectId: PROJECT_ID,
    name: "Errors to Slack",
    action: TriggerAction.SEND_SLACK_MESSAGE,
    triggerKind: TriggerKind.AUTOMATION,
    actionParams: { slackWebhook: "https://hooks.slack.test/abc" },
    filters: {},
    filterQuery: "status:error",
    customGraphId: null,
    notificationCadence: "immediate",
    traceDebounceMs: 30_000,
    active: true,
    pausedReason: null,
    deleted: false,
    ...overrides,
  };
}

describe("automationRouter in-depth view reads", () => {
  let caller: ReturnType<typeof createTestCaller>;
  let previousApp: typeof globalForApp.__langwatch_app;

  beforeEach(() => {
    vi.clearAllMocks();
    previousApp = globalForApp.__langwatch_app;
    const triggerService = new TriggerService(
      new PrismaTriggerRepository(mockPrismaClient),
    );
    Object.assign(triggerService, {
      getReportSchedules: mockGetReportSchedules,
    });
    globalForApp.__langwatch_app = createTestApp({ triggers: triggerService });
    caller = createTestCaller();
  });

  afterEach(() => {
    globalForApp.__langwatch_app = previousApp;
  });

  describe("getFireHistory", () => {
    describe("when there are more fires than the page holds", () => {
      it("returns one page and a cursor onto the next", async () => {
        const rows = Array.from({ length: 3 }, (_, index) => ({
          id: `sent_${index}`,
          triggerId: TRIGGER_ID,
          customGraphId: null,
          createdAt: new Date(Date.UTC(2026, 7, 12, 12, 0, index)),
          resolvedAt: null,
        }));
        mockTriggerSentFindMany.mockResolvedValue(rows);

        const page = await caller.getFireHistory({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          limit: 2,
        });

        expect(page.fires).toHaveLength(2);
        expect(page.nextCursor).toEqual({
          createdAt: rows[1]!.createdAt,
          id: "sent_1",
        });
        // One extra row is read to answer "is there more?" without a count.
        expect(mockTriggerSentFindMany).toHaveBeenCalledWith(
          expect.objectContaining({ take: 3 }),
        );
      });
    });

    describe("when the page is the last one", () => {
      it("returns no cursor", async () => {
        mockTriggerSentFindMany.mockResolvedValue([
          {
            id: "sent_only",
            triggerId: TRIGGER_ID,
            customGraphId: null,
            createdAt: new Date(),
            resolvedAt: null,
          },
        ]);

        const page = await caller.getFireHistory({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          limit: 20,
        });

        expect(page.nextCursor).toBeNull();
      });
    });

    describe("when a cursor is supplied", () => {
      it("reads strictly older rows, breaking ties on the row id", async () => {
        const createdAt = new Date(Date.UTC(2026, 7, 12, 12, 0, 0));
        mockTriggerSentFindMany.mockResolvedValue([]);

        await caller.getFireHistory({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          limit: 20,
          cursor: { createdAt, id: "sent_5" },
        });

        expect(mockTriggerSentFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              projectId: PROJECT_ID,
              triggerId: TRIGGER_ID,
              OR: [
                { createdAt: { lt: createdAt } },
                { createdAt, id: { lt: "sent_5" } },
              ],
            }),
          }),
        );
      });
    });

    describe("when the fires are read", () => {
      it("never selects a trace id", async () => {
        mockTriggerSentFindMany.mockResolvedValue([]);

        await caller.getFireHistory({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
          limit: 20,
        });

        const select = mockTriggerSentFindMany.mock.calls[0]?.[0]?.select;
        // Fire history is gated by `triggers:view`, which is weaker than
        // trace-content permission — a trace id here would be a side door.
        expect(select).not.toHaveProperty("traceId");
        expect(select).toMatchObject({ id: true, createdAt: true });
      });
    });
  });

  describe("getLatestEvaluation", () => {
    describe("when the alert has been evaluated", () => {
      it("returns what the check observed and decided", async () => {
        const evaluatedAt = new Date(Date.UTC(2026, 7, 12, 12, 0, 0));
        mockLatestEvaluationFindFirst.mockResolvedValue({
          triggerId: TRIGGER_ID,
          projectId: PROJECT_ID,
          evaluatedAt,
          verdict: "not_breached",
          observedValue: 42,
          threshold: 100,
          operator: "gt",
          timePeriodMinutes: 60,
          skipCode: null,
          updatedAt: evaluatedAt,
        });

        const evaluation = await caller.getLatestEvaluation({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
        });

        expect(evaluation).toEqual({
          triggerId: TRIGGER_ID,
          projectId: PROJECT_ID,
          evaluatedAt,
          verdict: "not_breached",
          observedValue: 42,
          threshold: 100,
          operator: "gt",
          timePeriodMinutes: 60,
          skipCode: null,
        });
        expect(mockLatestEvaluationFindFirst).toHaveBeenCalledWith({
          where: { projectId: PROJECT_ID, triggerId: TRIGGER_ID },
        });
      });
    });

    describe("when the alert has never been evaluated", () => {
      it("returns nothing rather than an invented record", async () => {
        mockLatestEvaluationFindFirst.mockResolvedValue(null);

        await expect(
          caller.getLatestEvaluation({
            projectId: PROJECT_ID,
            triggerId: TRIGGER_ID,
          }),
        ).resolves.toBeNull();
      });
    });
  });

  describe("getNextFiring", () => {
    describe("when the automation is a report", () => {
      it("answers from the scheduler that owns the calendar entry", async () => {
        const nextRunAt = new Date(Date.UTC(2026, 7, 13, 9, 0, 0));
        mockTriggerFindUnique.mockResolvedValue(
          traceAutomationRow({
            triggerKind: TriggerKind.REPORT,
            filterQuery: null,
          }),
        );
        mockGetReportSchedules.mockResolvedValue([
          {
            triggerId: TRIGGER_ID,
            nextRunAt,
            lastRunAt: null,
            active: true,
          },
        ]);

        const next = await caller.getNextFiring({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
        });

        expect(next).toEqual({ kind: "schedule", nextRunAt });
      });
    });

    describe("when the automation acts on traces immediately", () => {
      it("answers with the debounce it waits out, and asks the scheduler nothing", async () => {
        mockTriggerFindUnique.mockResolvedValue(traceAutomationRow());

        const next = await caller.getNextFiring({
          projectId: PROJECT_ID,
          triggerId: TRIGGER_ID,
        });

        expect(next).toEqual({ kind: "immediate", traceDebounceMs: 30_000 });
        expect(mockGetReportSchedules).not.toHaveBeenCalled();
      });
    });

    describe("when the automation does not exist in this project", () => {
      it("reports it as not found", async () => {
        mockTriggerFindUnique.mockResolvedValue(null);

        await expect(
          caller.getNextFiring({
            projectId: PROJECT_ID,
            triggerId: TRIGGER_ID,
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
    });
  });
});
