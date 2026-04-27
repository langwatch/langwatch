/**
 * @vitest-environment node
 *
 * Router-level tests for automation filter validation and update sanitization.
 */
import { TriggerAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnforceLicenseLimit, mockTriggerUpdate } = vi.hoisted(() => ({
  mockEnforceLicenseLimit: vi.fn().mockResolvedValue(undefined),
  mockTriggerUpdate: vi.fn(),
}));

vi.mock("~/server/license-enforcement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/license-enforcement")>();

  return {
    ...actual,
    enforceLicenseLimit: mockEnforceLicenseLimit,
  };
});

vi.mock("../../rbac", () => ({
  checkProjectPermission: vi.fn().mockImplementation(() => {
    return async ({ ctx, next }: any) =>
      next({
        ctx: { ...ctx, permissionChecked: true },
      });
  }),
}));

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

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceLicenseLimit.mockResolvedValue(undefined);
    mockTriggerUpdate.mockResolvedValue({
      id: "trigger_test_123",
      filters: JSON.stringify({ "spans.model": ["gpt-5-mini"] }),
    });
    caller = createTestCaller();
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
