/**
 * @vitest-environment node
 *
 * Router-level tests for automation filter validation and update sanitization.
 */
import { TriggerAction } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalForApp } from "../../../app-layer/app";
import { createTestApp } from "../../../app-layer/presets";

const {
  mockEnforceLicenseLimit,
  mockTriggerUpdate,
  mockTriggerCreate,
  mockTriggerFindFirst,
  mockTriggerFindMany,
  mockTriggerFindUnique,
  mockMonitorFindMany,
  mockCustomGraphFindUnique,
  mockCustomGraphFindMany,
  mockTriggersInvalidate,
  mockSyncReportSchedule,
  mockRemoveReportSchedule,
  mockTriggerSentGroupBy,
  mockTriggerSentFindMany,
  mockFeatureFlagIsEnabled,
  mockRateLimit,
} = vi.hoisted(() => ({
  mockEnforceLicenseLimit: vi.fn().mockResolvedValue(undefined),
  mockTriggerUpdate: vi.fn(),
  mockTriggerCreate: vi.fn(),
  mockTriggerFindFirst: vi.fn(),
  mockTriggerFindMany: vi.fn(),
  mockTriggerFindUnique: vi.fn(),
  mockMonitorFindMany: vi.fn(),
  mockCustomGraphFindUnique: vi.fn(),
  mockCustomGraphFindMany: vi.fn(),
  mockTriggersInvalidate: vi.fn().mockResolvedValue(undefined),
  mockSyncReportSchedule: vi.fn().mockResolvedValue(undefined),
  mockRemoveReportSchedule: vi.fn().mockResolvedValue(undefined),
  mockTriggerSentGroupBy: vi.fn(),
  mockTriggerSentFindMany: vi.fn(),
  mockFeatureFlagIsEnabled: vi.fn().mockResolvedValue(true),
  mockRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    remaining: 9,
    resetAt: Date.now() + 60_000,
  }),
}));

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: { isEnabled: mockFeatureFlagIsEnabled },
}));

vi.mock("../../../rateLimit", () => ({
  rateLimit: mockRateLimit,
}));

vi.mock("~/server/license-enforcement", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/server/license-enforcement")>();

  return {
    ...actual,
    enforceLicenseLimit: mockEnforceLicenseLimit,
  };
});

vi.mock("../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../rbac")>();
  return {
    ...actual,
    checkProjectPermission: vi.fn().mockImplementation(() => {
      return async ({ ctx, next }: any) =>
        next({
          ctx: { ...ctx, permissionChecked: true },
        });
    }),
  };
});

vi.mock("~/server/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

import { automationRouter } from "../automations";

function createTestCaller() {
  const ctx = {
    session: {
      user: { id: "user_test_123" },
      expires: "2099-01-01",
    },
    req: undefined,
    res: undefined,
    prisma: {
      trigger: {
        update: mockTriggerUpdate,
        create: mockTriggerCreate,
        findFirst: mockTriggerFindFirst,
        findMany: mockTriggerFindMany,
        findUnique: mockTriggerFindUnique,
      },
      monitor: {
        findMany: mockMonitorFindMany,
      },
      customGraph: {
        findUnique: mockCustomGraphFindUnique,
        findMany: mockCustomGraphFindMany,
      },
      triggerSent: {
        groupBy: mockTriggerSentGroupBy,
        findMany: mockTriggerSentFindMany,
      },
    },
    permissionChecked: false,
    publiclyShared: false,
    organizationRole: undefined,
  } as any;

  return automationRouter.createCaller(ctx);
}

describe("automationRouter", () => {
  let caller: ReturnType<typeof createTestCaller>;
  let previousApp: typeof globalForApp.__langwatch_app;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceLicenseLimit.mockResolvedValue(undefined);
    mockTriggerUpdate.mockResolvedValue({
      id: "trigger_test_123",
      filters: JSON.stringify({ "spans.model": ["gpt-5-mini"] }),
    });
    previousApp = globalForApp.__langwatch_app;
    globalForApp.__langwatch_app = createTestApp({
      triggers: {
        invalidate: mockTriggersInvalidate,
        syncReportSchedule: mockSyncReportSchedule,
        removeReportSchedule: mockRemoveReportSchedule,
      } as any,
    });
    caller = createTestCaller();
  });

  afterEach(() => {
    globalForApp.__langwatch_app = previousApp;
  });

  describe("create", () => {
    it("rejects SEND_WEBHOOK because only provider-aware upsert can persist it", async () => {
      await expect(
        caller.create({
          projectId: "proj_123",
          name: "Malformed webhook",
          action: TriggerAction.SEND_WEBHOOK,
          filters: {},
          actionParams: {},
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(mockTriggerCreate).not.toHaveBeenCalled();
    });

    describe("when the input contains an unknown filter field", () => {
      it("rejects the request before resolver logic runs", async () => {
        await expect(
          caller.create({
            projectId: "proj_123",
            name: "Unknown field trigger",
            action: TriggerAction.SEND_SLACK_MESSAGE,
            filters: { "service.name": ["chat"] },
            actionParams: {
              slackWebhook: "https://hooks.slack.test/unknown-field",
            },
          } as any),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      });

      it("does not reach license enforcement", async () => {
        await expect(
          caller.create({
            projectId: "proj_123",
            name: "Unknown field trigger",
            action: TriggerAction.SEND_SLACK_MESSAGE,
            filters: { "service.name": ["chat"] },
            actionParams: {
              slackWebhook: "https://hooks.slack.test/unknown-field",
            },
          } as any),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });

        expect(mockEnforceLicenseLimit).not.toHaveBeenCalled();
      });
    });
  });

  describe("testFireTemplate", () => {
    it("does not carry kept header secrets to a changed webhook URL", async () => {
      mockTriggerFindUnique.mockResolvedValueOnce({
        actionParams: {
          url: "https://saved.example/hook",
          method: "POST",
          headers: { Authorization: "Bearer saved-secret" },
          bodyTemplate: null,
        },
      });

      await expect(
        caller.testFireTemplate({
          projectId: "proj_123",
          channel: "webhook",
          trigger: { name: "Webhook", alertType: null },
          draft: {},
          webhook: null,
          webhookDestination: {
            url: "https://attacker.example/collect",
            method: "POST",
            headers: { Authorization: "__kept__" },
            bodyTemplate: null,
          },
          botDestination: null,
          automationId: "trigger_test_123",
          graphAlert: null,
          report: null,
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringMatching(/Re-enter webhook header values/),
      });
    });
  });

  describe("upsert with graph-alert variant", () => {
    const baseGraphAlertInput = {
      projectId: "proj_123",
      name: "p95 latency",
      action: TriggerAction.SEND_SLACK_MESSAGE,
      alertType: "WARNING" as const,
      filters: {},
      customGraphId: "graph_1",
      graphAlert: {
        seriesName: "0/latency/p95",
        operator: "gt" as const,
        threshold: 250,
        timePeriod: 60 as const,
      },
      actionParams: {
        slackWebhook: "https://hooks.slack.com/services/abc",
      },
      templates: {
        slackTemplate: null,
        slackTemplateType: null,
        emailSubjectTemplate: null,
        emailBodyTemplate: null,
      },
    };

    describe("when the customGraphId belongs to the project", () => {
      describe("on create (no triggerId)", () => {
        it("merges the threshold rule into actionParams and persists the graph-alert row", async () => {
          mockCustomGraphFindUnique.mockResolvedValueOnce({ id: "graph_1" });
          mockTriggerCreate.mockResolvedValueOnce({ id: "trigger_new" });

          await caller.upsert(baseGraphAlertInput as any);

          expect(mockCustomGraphFindUnique).toHaveBeenCalledWith({
            where: { id: "graph_1", projectId: "proj_123" },
            select: { id: true },
          });
          expect(mockTriggerCreate).toHaveBeenCalledTimes(1);
          const createArgs = mockTriggerCreate.mock.calls[0]![0];
          expect(createArgs.data.customGraphId).toBe("graph_1");
          expect(createArgs.data.action).toBe(TriggerAction.SEND_SLACK_MESSAGE);
          expect(createArgs.data.alertType).toBe("WARNING");
          // Filters are forced to {} on graph alerts (SSOT builder writes an
          // object, not a JSON string) — the conditions live on the graph
          // itself, not on the trigger.
          expect(createArgs.data.filters).toEqual({});
          // Threshold rule is merged into actionParams so the dispatcher
          // sees ONE shape regardless of which creation path was used.
          expect(createArgs.data.actionParams).toMatchObject({
            slackWebhook: "https://hooks.slack.com/services/abc",
            threshold: 250,
            operator: "gt",
            timePeriod: 60,
            seriesName: "0/latency/p95",
          });
          // Name is prefixed to match the dashboard "Add Alert" path so the
          // same trigger appears identically through both creators.
          expect(createArgs.data.name).toBe("p95 latency");
          expect(createArgs.data.triggerKind).toBe("ALERT");
        });
      });

      describe("on create when the saved row carries an encrypted bot token", () => {
        it("redacts slackBotToken from the mutation response (ADR-041)", async () => {
          mockCustomGraphFindUnique.mockResolvedValueOnce({ id: "graph_1" });
          mockTriggerCreate.mockResolvedValueOnce({
            id: "trigger_new",
            action: TriggerAction.SEND_SLACK_MESSAGE,
            actionParams: {
              slackDelivery: "bot",
              slackChannelId: "C123",
              slackBotToken: "encrypted-ciphertext",
            },
          });

          const result = await caller.upsert(baseGraphAlertInput as any);

          expect(
            (result.actionParams as Record<string, unknown>).slackBotToken,
          ).toBeUndefined();
          expect(
            (result.actionParams as Record<string, unknown>).slackBotTokenSet,
          ).toBe(true);
        });
      });

      describe("on create when a Slack secret rides along on an email action", () => {
        it("strips undeclared keys via the per-action schema before persisting", async () => {
          mockCustomGraphFindUnique.mockResolvedValueOnce({ id: "graph_1" });
          mockTriggerCreate.mockResolvedValueOnce({ id: "trigger_new" });

          await caller.upsert({
            ...baseGraphAlertInput,
            action: TriggerAction.SEND_EMAIL,
            actionParams: {
              members: ["ops@example.com"],
              // A token typed before switching the channel to Email must not
              // land in the row in plaintext — the Slack-only encrypt/redact
              // passes would never touch it there.
              slackBotToken: "xoxb-should-never-persist",
            },
          } as any);

          expect(mockTriggerCreate).toHaveBeenCalledTimes(1);
          const createArgs = mockTriggerCreate.mock.calls[0]![0];
          const persisted = createArgs.data.actionParams as Record<
            string,
            unknown
          >;
          expect(persisted.slackBotToken).toBeUndefined();
          expect(persisted.members).toEqual(["ops@example.com"]);
        });
      });

      describe("on create when a soft-deleted alert already occupies the graph", () => {
        it("reactivates the existing row instead of hitting the unique constraint", async () => {
          mockCustomGraphFindUnique.mockResolvedValueOnce({ id: "graph_1" });
          // deleteById soft-deletes: the row stays and keeps customGraphId's
          // @unique slot. A fresh create would throw P2002 → 500.
          mockTriggerFindFirst.mockResolvedValueOnce({
            id: "trigger_soft_deleted",
            projectId: "proj_123",
            customGraphId: "graph_1",
            deleted: true,
          });
          mockTriggerUpdate.mockResolvedValueOnce({
            id: "trigger_soft_deleted",
          });

          await caller.upsert(baseGraphAlertInput as any);

          expect(mockTriggerCreate).not.toHaveBeenCalled();
          expect(mockTriggerFindFirst).toHaveBeenCalledWith({
            where: { projectId: "proj_123", customGraphId: "graph_1" },
          });
          expect(mockTriggerUpdate).toHaveBeenCalledTimes(1);
          const updateArgs = mockTriggerUpdate.mock.calls[0]![0];
          expect(updateArgs.where).toEqual({
            id: "trigger_soft_deleted",
            projectId: "proj_123",
          });
          expect(updateArgs.data.deleted).toBe(false);
          expect(updateArgs.data.active).toBe(true);
          expect(updateArgs.data.customGraphId).toBe("graph_1");
        });
      });
    });

    describe("when the customGraphId does not belong to the project", () => {
      it("rejects with NOT_FOUND before persisting", async () => {
        mockCustomGraphFindUnique.mockResolvedValueOnce(null);

        await expect(
          caller.upsert(baseGraphAlertInput as any),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });

        expect(mockTriggerCreate).not.toHaveBeenCalled();
      });
    });

    describe("when the action is not a notify channel", () => {
      it("rejects ADD_TO_DATASET on a graph alert", async () => {
        await expect(
          caller.upsert({
            ...baseGraphAlertInput,
            action: TriggerAction.ADD_TO_DATASET,
            actionParams: { datasetId: "dataset_1" },
          } as any),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });

        expect(mockCustomGraphFindUnique).not.toHaveBeenCalled();
        expect(mockTriggerCreate).not.toHaveBeenCalled();
      });
    });

    describe("when the alert severity is missing", () => {
      it("rejects with BAD_REQUEST before the tenancy lookup", async () => {
        await expect(
          caller.upsert({
            ...baseGraphAlertInput,
            alertType: null,
          } as any),
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message: "Graph alerts require an alert severity.",
        });

        // The severity guard runs before the customGraph tenancy lookup,
        // so the DB is never touched for an invalid payload.
        expect(mockCustomGraphFindUnique).not.toHaveBeenCalled();
        expect(mockTriggerCreate).not.toHaveBeenCalled();
      });
    });

    describe("when editing an existing graph alert (triggerId set)", () => {
      it("routes the update through the SSOT builder shape", async () => {
        mockCustomGraphFindUnique.mockResolvedValueOnce({ id: "graph_1" });
        mockTriggerUpdate.mockResolvedValueOnce({ id: "trigger-1" });

        await caller.upsert({
          ...baseGraphAlertInput,
          triggerId: "trigger-1",
        } as any);

        expect(mockTriggerCreate).not.toHaveBeenCalled();
        expect(mockTriggerUpdate).toHaveBeenCalledTimes(1);
        const updateArgs = mockTriggerUpdate.mock.calls[0]![0];
        expect(updateArgs.where).toEqual({
          id: "trigger-1",
          projectId: "proj_123",
        });
        // Same builder-shaped row as the create path: threshold rule merged
        // into actionParams, filters forced to {}, name "Alert: "-prefixed.
        expect(updateArgs.data.actionParams).toMatchObject({
          slackWebhook: "https://hooks.slack.com/services/abc",
          threshold: 250,
          operator: "gt",
          timePeriod: 60,
          seriesName: "0/latency/p95",
        });
        expect(updateArgs.data.filters).toEqual({});
        expect(updateArgs.data.name).toBe("p95 latency");
        expect(updateArgs.data.triggerKind).toBe("ALERT");
        expect(updateArgs.data.alertType).toBe("WARNING");
        expect(updateArgs.data.customGraphId).toBe("graph_1");
      });
    });

    describe("notification cadence pinning", () => {
      // Graph alerts are incident-based (fire on breach, silent while open,
      // resolve on recovery) — there is nothing to digest, so the storage
      // boundary pins cadence to `immediate` on both write paths, overriding
      // whatever the client requested (the isGraphAlert→immediate guard in
      // resolveCadenceForCreate / resolveCadenceForUpdate).
      describe("on create (no triggerId)", () => {
        it("pins the persisted cadence to immediate", async () => {
          mockCustomGraphFindUnique.mockResolvedValueOnce({ id: "graph_1" });
          mockTriggerCreate.mockResolvedValueOnce({ id: "trigger_new" });

          await caller.upsert(baseGraphAlertInput as any);

          const createArgs = mockTriggerCreate.mock.calls[0]![0];
          expect(createArgs.data.notificationCadence).toBe("immediate");
        });

        it("overrides a requested 5min_digest with immediate", async () => {
          mockCustomGraphFindUnique.mockResolvedValueOnce({ id: "graph_1" });
          mockTriggerCreate.mockResolvedValueOnce({ id: "trigger_new" });

          await caller.upsert({
            ...baseGraphAlertInput,
            notificationCadence: "5min_digest",
          } as any);

          const createArgs = mockTriggerCreate.mock.calls[0]![0];
          expect(createArgs.data.notificationCadence).toBe("immediate");
        });
      });

      describe("on edit (triggerId set)", () => {
        it("pins the persisted cadence to immediate", async () => {
          mockCustomGraphFindUnique.mockResolvedValueOnce({ id: "graph_1" });
          mockTriggerUpdate.mockResolvedValueOnce({ id: "trigger-1" });

          await caller.upsert({
            ...baseGraphAlertInput,
            triggerId: "trigger-1",
          } as any);

          const updateArgs = mockTriggerUpdate.mock.calls[0]![0];
          expect(updateArgs.data.notificationCadence).toBe("immediate");
        });

        it("overrides a requested 5min_digest with immediate", async () => {
          mockCustomGraphFindUnique.mockResolvedValueOnce({ id: "graph_1" });
          mockTriggerUpdate.mockResolvedValueOnce({ id: "trigger-1" });

          await caller.upsert({
            ...baseGraphAlertInput,
            triggerId: "trigger-1",
            notificationCadence: "5min_digest",
          } as any);

          const updateArgs = mockTriggerUpdate.mock.calls[0]![0];
          expect(updateArgs.data.notificationCadence).toBe("immediate");
        });
      });
    });

    describe("when the graphAlert rule is missing", () => {
      it("rejects the upsert", async () => {
        await expect(
          caller.upsert({
            ...baseGraphAlertInput,
            graphAlert: undefined,
          } as any),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      });
    });

    describe("when the operator is invalid", () => {
      it("rejects on schema validation", async () => {
        await expect(
          caller.upsert({
            ...baseGraphAlertInput,
            graphAlert: {
              ...baseGraphAlertInput.graphAlert,
              operator: "between",
            },
          } as any),
        ).rejects.toBeDefined();
      });
    });

    describe("when timePeriod is outside the allowed set", () => {
      it("rejects on schema validation", async () => {
        await expect(
          caller.upsert({
            ...baseGraphAlertInput,
            graphAlert: {
              ...baseGraphAlertInput.graphAlert,
              timePeriod: 7,
            },
          } as any),
        ).rejects.toBeDefined();
      });
    });
  });

  describe("upsert with report variant", () => {
    const baseReportInput = {
      projectId: "proj_123",
      name: "Weekly errors",
      action: TriggerAction.SEND_SLACK_MESSAGE,
      filters: {},
      report: {
        source: {
          kind: "traceQuery" as const,
          filters: { "traces.error": ["true"] },
          topN: 5,
        },
        schedule: { cron: "0 9 * * 1", timezone: "UTC" },
        compareToPrevious: false,
      },
      actionParams: { slackWebhook: "https://hooks.slack.com/services/abc" },
      templates: {
        slackTemplate: null,
        slackTemplateType: null,
        emailSubjectTemplate: null,
        emailBodyTemplate: null,
      },
    };

    describe("on create", () => {
      it("persists a REPORT row and syncs the calendar schedule", async () => {
        mockTriggerCreate.mockResolvedValueOnce({ id: "report_trig" });

        await caller.upsert(baseReportInput as any);

        expect(mockTriggerCreate).toHaveBeenCalledTimes(1);
        const createArgs = mockTriggerCreate.mock.calls[0]![0];
        expect(createArgs.data.triggerKind).toBe("REPORT");
        expect(createArgs.data.filters).toEqual({});
        expect(createArgs.data.actionParams).toMatchObject({
          source: { kind: "traceQuery", topN: 5 },
          schedule: { cron: "0 9 * * 1", timezone: "UTC" },
          slackWebhook: "https://hooks.slack.com/services/abc",
        });
        expect(mockSyncReportSchedule).toHaveBeenCalledWith({
          projectId: "proj_123",
          triggerId: "report_trig",
          cron: "0 9 * * 1",
          timezone: "UTC",
        });
      });
    });

    describe("when the schedule is one the scheduler cannot run", () => {
      // The row used to be committed ACTIVE first and the cron only parsed
      // afterwards, inside computeNextRunAt — so a bad cron threw a 500 and
      // left a live report with no calendar entry that could never fire.
      it.each([
        { name: "a malformed cron", cron: "every monday", timezone: "UTC" },
        { name: "a seconds-granularity cron", cron: "* * * * * *", timezone: "UTC" },
        { name: "a cron that sends every minute", cron: "* * * * *", timezone: "UTC" },
        { name: "an unknown timezone", cron: "0 9 * * 1", timezone: "Mars/Olympus" },
      ])("rejects $name before anything is written", async ({ cron, timezone }) => {
        await expect(
          caller.upsert({
            ...baseReportInput,
            report: {
              ...baseReportInput.report,
              schedule: { cron, timezone },
            },
          } as any),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });

        expect(mockTriggerCreate).not.toHaveBeenCalled();
        expect(mockTriggerUpdate).not.toHaveBeenCalled();
        expect(mockSyncReportSchedule).not.toHaveBeenCalled();
      });
    });
  });

  describe("toggleTrigger", () => {
    const reportRow = {
      triggerKind: "REPORT",
      actionParams: {
        source: { kind: "traceQuery", filters: {}, topN: 5 },
        schedule: { cron: "0 9 * * 1", timezone: "Europe/Amsterdam" },
        compareToPrevious: false,
      },
    };

    describe("when a REPORT is paused", () => {
      it("retires its scheduler job, so it stops claiming slots it will never send", async () => {
        mockTriggerFindUnique.mockResolvedValueOnce(reportRow);
        mockTriggerUpdate.mockResolvedValueOnce({
          id: "report_trig",
          active: false,
        });

        await caller.toggleTrigger({
          projectId: "proj_123",
          triggerId: "report_trig",
          active: false,
        });

        expect(mockRemoveReportSchedule).toHaveBeenCalledWith({
          projectId: "proj_123",
          triggerId: "report_trig",
        });
        expect(mockSyncReportSchedule).not.toHaveBeenCalled();
      });
    });

    describe("when a REPORT is resumed", () => {
      it("puts it back on the calendar with its own cron and timezone", async () => {
        mockTriggerFindUnique.mockResolvedValueOnce(reportRow);
        mockTriggerUpdate.mockResolvedValueOnce({
          id: "report_trig",
          active: true,
        });

        await caller.toggleTrigger({
          projectId: "proj_123",
          triggerId: "report_trig",
          active: true,
        });

        expect(mockSyncReportSchedule).toHaveBeenCalledWith({
          projectId: "proj_123",
          triggerId: "report_trig",
          cron: "0 9 * * 1",
          timezone: "Europe/Amsterdam",
        });
        expect(mockRemoveReportSchedule).not.toHaveBeenCalled();
      });
    });

    describe("when a non-report automation is toggled", () => {
      it("leaves the scheduler alone", async () => {
        mockTriggerFindUnique.mockResolvedValueOnce({
          triggerKind: "AUTOMATION",
          actionParams: { slackWebhook: "https://hooks.slack.com/services/x" },
        });
        mockTriggerUpdate.mockResolvedValueOnce({
          id: "trigger_test_123",
          active: false,
        });

        await caller.toggleTrigger({
          projectId: "proj_123",
          triggerId: "trigger_test_123",
          active: false,
        });

        expect(mockRemoveReportSchedule).not.toHaveBeenCalled();
        expect(mockSyncReportSchedule).not.toHaveBeenCalled();
      });
    });

    describe("when the automation does not belong to the project", () => {
      it("rejects instead of toggling another tenant's row", async () => {
        mockTriggerFindUnique.mockResolvedValueOnce(null);

        await expect(
          caller.toggleTrigger({
            projectId: "proj_123",
            triggerId: "someone_elses_trigger",
            active: false,
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });

        expect(mockTriggerUpdate).not.toHaveBeenCalled();
      });
    });
  });

  describe("getTriggers", () => {
    describe("when some triggers point at custom graphs", () => {
      it("enriches only the graph-alert row with its customGraph", async () => {
        mockTriggerFindMany.mockResolvedValueOnce([
          {
            id: "trigger_graph",
            customGraphId: "graph-1",
            filters: "{}",
          },
          {
            id: "trigger_plain",
            customGraphId: null,
            filters: "{}",
          },
        ]);
        mockMonitorFindMany.mockResolvedValueOnce([]);
        mockCustomGraphFindMany.mockResolvedValueOnce([
          { id: "graph-1", name: "p95 latency" },
        ]);

        const result = await caller.getTriggers({ projectId: "proj_123" });

        // Multitenancy: the graph lookup is scoped to the calling project.
        expect(mockCustomGraphFindMany).toHaveBeenCalledWith({
          where: { id: { in: ["graph-1"] }, projectId: "proj_123" },
          select: { id: true, name: true },
        });
        const graphRow = result.find((t) => t.id === "trigger_graph");
        const plainRow = result.find((t) => t.id === "trigger_plain");
        expect(graphRow?.customGraph).toEqual({
          id: "graph-1",
          name: "p95 latency",
        });
        expect(plainRow?.customGraph).toBeNull();
      });
    });

    describe("when a trigger points at a graph that no longer exists", () => {
      it("returns customGraph null instead of crashing", async () => {
        mockTriggerFindMany.mockResolvedValueOnce([
          {
            id: "trigger_dangling",
            customGraphId: "graph-gone",
            filters: "{}",
          },
        ]);
        mockMonitorFindMany.mockResolvedValueOnce([]);
        mockCustomGraphFindMany.mockResolvedValueOnce([]);

        const result = await caller.getTriggers({ projectId: "proj_123" });

        expect(result).toHaveLength(1);
        expect(result[0]?.customGraph).toBeNull();
      });
    });
  });

  describe("getTriggerStats", () => {
    describe("when a project has fire history", () => {
      beforeEach(() => {
        mockTriggerSentGroupBy.mockImplementation(
          ({ _max }: { _max?: unknown }) =>
            Promise.resolve(
              _max
                ? [
                    {
                      triggerId: "trigger_1",
                      _max: { createdAt: new Date("2026-07-09T10:00:00Z") },
                    },
                  ]
                : [{ triggerId: "trigger_1", _count: { _all: 4 } }],
            ),
        );
        mockTriggerSentFindMany.mockResolvedValue([
          { triggerId: "trigger_1" },
        ]);
      });

      it("scopes every fire-history read to the calling project", async () => {
        await caller.getTriggerStats({ projectId: "proj_123" });

        for (const call of mockTriggerSentGroupBy.mock.calls) {
          expect(call[0].where).toMatchObject({ projectId: "proj_123" });
        }
        expect(mockTriggerSentFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ projectId: "proj_123" }),
          }),
        );
      });

      it("returns the per-trigger rollup with the open-incident flag", async () => {
        const result = await caller.getTriggerStats({
          projectId: "proj_123",
        });

        expect(result).toEqual([
          {
            triggerId: "trigger_1",
            lastFiredAt: new Date("2026-07-09T10:00:00Z"),
            recentFireCount: 4,
            currentlyFiring: true,
          },
        ]);
      });

      it("only counts unresolved graph-alert rows as firing", async () => {
        await caller.getTriggerStats({ projectId: "proj_123" });

        expect(mockTriggerSentFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              customGraphId: { not: null },
              resolvedAt: null,
            }),
          }),
        );
      });
    });
  });

  describe("getRecentFires", () => {
    describe("when listing a trigger's fire history", () => {
      beforeEach(() => {
        mockTriggerSentFindMany.mockResolvedValue([
          {
            id: "sent_1",
            triggerId: "trigger_1",
            customGraphId: null,
            createdAt: new Date("2026-07-09T10:00:00Z"),
            resolvedAt: null,
          },
        ]);
      });

      it("scopes the read to the calling project and trigger", async () => {
        await caller.getRecentFires({
          projectId: "proj_123",
          triggerId: "trigger_1",
        });

        expect(mockTriggerSentFindMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { projectId: "proj_123", triggerId: "trigger_1" },
            take: 20,
          }),
        );
      });

      it("selects fire metadata only, never trace references or content", async () => {
        const result = await caller.getRecentFires({
          projectId: "proj_123",
          triggerId: "trigger_1",
        });

        const selectArg =
          mockTriggerSentFindMany.mock.calls[0]![0].select ?? {};
        expect(Object.keys(selectArg).sort()).toEqual([
          "createdAt",
          "customGraphId",
          "id",
          "resolvedAt",
          "triggerId",
        ]);
        expect(result[0]).not.toHaveProperty("traceId");
      });

      it("caps the page size at 20 rows", async () => {
        await expect(
          caller.getRecentFires({
            projectId: "proj_123",
            triggerId: "trigger_1",
            limit: 100,
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      });
    });
  });

  describe("updateTriggerFilters", () => {
    describe("when the input mixes supported and unsupported fields", () => {
      it("persists only the supported subset", async () => {
        await caller.updateTriggerFilters({
          projectId: "proj_123",
          triggerId: "trigger_test_123",
          filters: {
            "spans.model": ["gpt-5-mini"],
            "service.name": ["chat"],
          },
        });

        expect(mockTriggerUpdate).toHaveBeenCalledWith({
          where: { id: "trigger_test_123", projectId: "proj_123" },
          data: {
            filters: JSON.stringify({ "spans.model": ["gpt-5-mini"] }),
          },
        });
      });
    });

    describe("when the input contains only unsupported legacy fields", () => {
      it("rejects the update instead of broadening the trigger", async () => {
        await expect(
          caller.updateTriggerFilters({
            projectId: "proj_123",
            triggerId: "trigger_test_123",
            filters: {
              "service.name": ["chat"],
            },
          }),
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
          message:
            "This automation only contains unsupported legacy filters. Add at least one supported filter before saving.",
        });
      });

      it("does not persist an empty filter set", async () => {
        await expect(
          caller.updateTriggerFilters({
            projectId: "proj_123",
            triggerId: "trigger_test_123",
            filters: {
              "service.name": ["chat"],
            },
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });

        expect(mockTriggerUpdate).not.toHaveBeenCalled();
      });
    });
  });
});
