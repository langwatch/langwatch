/**
 * @vitest-environment node
 *
 * Unit test verifying that scenario-crud router passes the session
 * through to trackServerEvent, so impersonation suppression works.
 *
 * @see specs/features/impersonation-analytics-suppression.feature
 *   "tRPC router passes session to trackServerEvent during impersonation"
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockTrackServerEvent } = vi.hoisted(() => ({
  mockTrackServerEvent: vi.fn(),
}));

vi.mock("~/server/posthog", () => ({
  trackServerEvent: mockTrackServerEvent,
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../../rbac", () => ({
  checkProjectPermission: vi.fn().mockImplementation(() => {
    return async ({ ctx, next }: any) => {
      return next({ ctx: { ...ctx, permissionChecked: true } });
    };
  }),
}));

vi.mock("~/server/license-enforcement", () => ({
  enforceLicenseLimit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/server/db", () => ({
  prisma: {},
}));

vi.mock("~/server/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/server/scenarios/scenario.service", () => {
  const mockCreate = vi.fn().mockResolvedValue({
    id: "scen_new",
    projectId: "proj_123",
    name: "Test Scenario",
    situation: "A test",
    criteria: [],
    labels: [],
  });

  return {
    ScenarioService: {
      create: vi.fn().mockReturnValue({
        create: mockCreate,
        getAll: vi.fn(),
        getById: vi.fn(),
        getByIdIncludingArchived: vi.fn(),
        update: vi.fn(),
        archive: vi.fn(),
        batchArchive: vi.fn(),
      }),
    },
  };
});

import { scenarioCrudRouter } from "../scenario-crud.router";
import { createInnerTRPCContext } from "../../../../api/trpc";

function createTestCaller(sessionOverrides: Record<string, unknown> = {}) {
  const ctx = createInnerTRPCContext({
    session: {
      user: { id: "user_test_123", ...sessionOverrides },
      expires: "2099-01-01",
    } as any,
  });
  return {
    caller: scenarioCrudRouter.createCaller({
      ...ctx,
      permissionChecked: true,
    }),
    session: ctx.session,
  };
}

describe("scenarioCrudRouter.create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given an admin is impersonating a user", () => {
    describe("when a scenario is created", () => {
      it("passes the session with impersonator to trackServerEvent", async () => {
        const { caller } = createTestCaller({
          impersonator: { email: "admin@example.com" },
        });

        await caller.create({
          projectId: "proj_123",
          name: "Test Scenario",
          situation: "A test situation",
        });

        expect(mockTrackServerEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            session: expect.objectContaining({
              user: expect.objectContaining({
                impersonator: { email: "admin@example.com" },
              }),
            }),
          }),
        );
      });
    });
  });

  describe("given a normal user session", () => {
    describe("when a scenario is created", () => {
      it("passes the session without impersonator to trackServerEvent", async () => {
        const { caller } = createTestCaller();

        await caller.create({
          projectId: "proj_123",
          name: "Test Scenario",
          situation: "A test situation",
        });

        expect(mockTrackServerEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: "user_test_123",
            event: "scenario_created",
            projectId: "proj_123",
            session: expect.objectContaining({
              user: expect.not.objectContaining({
                impersonator: expect.anything(),
              }),
            }),
          }),
        );
      });
    });
  });
});
