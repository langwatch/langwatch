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
  mockCustomGraphFindUnique,
  mockTriggersInvalidate,
} = vi.hoisted(() => ({
  mockEnforceLicenseLimit: vi.fn().mockResolvedValue(undefined),
  mockTriggerUpdate: vi.fn(),
  mockTriggerCreate: vi.fn(),
  mockCustomGraphFindUnique: vi.fn(),
  mockTriggersInvalidate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/server/license-enforcement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/license-enforcement")>();

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
      },
      customGraph: {
        findUnique: mockCustomGraphFindUnique,
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
      triggers: { invalidate: mockTriggersInvalidate } as any,
    });
    caller = createTestCaller();
  });

  afterEach(() => {
    globalForApp.__langwatch_app = previousApp;
  });

  describe("create", () => {
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
          expect(createArgs.data.name).toBe("Alert: p95 latency");
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
