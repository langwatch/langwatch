/**
 * @vitest-environment node
 *
 * The tRPC update path's red-team guards.
 *
 * A red-team update reads the stored row so a partial write can be merged
 * before the pairing rule is applied. That read can come back empty, and when
 * it did, the merge saw an all-undefined state and the pairing rule answered
 * for it — so updating a scenario that does not exist reported "needs an
 * attack objective". A caller acting on that goes looking for a configuration
 * bug in a scenario that was deleted, which is the wrong search entirely.
 *
 * rbac is stubbed here on purpose: these tests are about what the handler does
 * once it is allowed to run, and authz has its own suites.
 *
 * Covers @unit scenarios from specs/scenarios/red-team-scenarios.feature.
 */
import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../../trpc";
import { scenarioCrudRouter } from "../scenario-crud.router";

const { mockGetById, mockUpdate } = vi.hoisted(() => ({
  mockGetById: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock("~/server/scenarios/scenario.service", () => ({
  ScenarioService: {
    create: () => ({ getById: mockGetById, update: mockUpdate }),
  },
}));

vi.mock("../../../rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../rbac")>();
  return {
    ...actual,
    // The permission itself has its own suites; what this one needs is for
    // the handler to run. `enforcePermissionCheck` still demands the flag, so
    // the stub sets it rather than bypassing the middleware chain.
    checkProjectPermission:
      () =>
      async ({ ctx, next }: any) => {
        ctx.permissionChecked = true;
        return next();
      },
  };
});

vi.mock("~/server/posthog", () => ({ trackServerEvent: vi.fn() }));

// Every mutation goes through trpc's audit-log middleware, which writes a row
// with the module-level prisma client — not `ctx.prisma`, so a fixture context
// cannot stand in for it. Unmocked it opens a real Postgres connection, which
// passes on a machine that happens to run one locally and fails in CI, where
// nothing is listening. A unit test should not depend on either.
//
// The specifier has to be the one `trpc.ts` imports: a path that resolves to
// no module mocks nothing, silently, and the test then passes or fails on
// whether a database happens to be listening.
vi.mock("@ee/audit-log/auditLog", () => ({ auditLog: vi.fn() }));

function caller() {
  const ctx = createInnerTRPCContext({
    session: { user: { id: "user_1" }, expires: "1" },
    req: undefined,
    res: undefined,
  });
  ctx.prisma = { scenario: { count: vi.fn() } } as unknown as PrismaClient;
  return scenarioCrudRouter.createCaller(ctx);
}

const base = { id: "scenario_1", projectId: "project_1" };

const storedAttack = {
  redTeamStrategy: "crescendo",
  redTeamTarget: "get the agent to reveal its override code",
  redTeamTotalTurns: 30,
  redTeamConfig: null,
};

describe("scenarios.update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockResolvedValue({ id: "scenario_1" });
  });

  describe("given a red-team update for a scenario that does not exist", () => {
    it("reports it as missing, not as misconfigured", async () => {
      mockGetById.mockResolvedValue(null);

      await expect(
        caller().update({ ...base, redTeamStrategy: "goat" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("writes nothing", async () => {
      mockGetById.mockResolvedValue(null);

      await caller()
        .update({ ...base, redTeamStrategy: "goat" })
        .catch(() => undefined);

      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("given a strategy change on a scenario that already has an objective", () => {
    /** @scenario Changing strategy on a configured scenario does not resend the objective */
    it("is accepted, because the merge supplies the objective", async () => {
      mockGetById.mockResolvedValue({ id: "scenario_1", ...storedAttack });

      await caller().update({ ...base, redTeamStrategy: "goat" });

      expect(mockUpdate).toHaveBeenCalledWith(
        "scenario_1",
        "project_1",
        expect.objectContaining({ redTeamStrategy: "goat" }),
      );
    });
  });

  describe("given an update that clears only the strategy", () => {
    /** @scenario Clearing the strategy clears the whole attack */
    it("clears the rest of the attack with it", async () => {
      mockGetById.mockResolvedValue({ id: "scenario_1", ...storedAttack });

      await caller().update({ ...base, redTeamStrategy: null });

      expect(mockUpdate).toHaveBeenCalledWith(
        "scenario_1",
        "project_1",
        expect.objectContaining({
          redTeamStrategy: null,
          redTeamTarget: null,
          redTeamTotalTurns: null,
        }),
      );
    });
  });

  describe("given an update that does not mention the attack", () => {
    it("does not read the stored row to find that out", async () => {
      // A rename should not pay for a round trip, which is also why the
      // missing-row check lives inside the red-team branch.
      await caller().update({ ...base, name: "Renamed" });

      expect(mockGetById).not.toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalled();
    });
  });

  describe("given an update that clears the objective but keeps the strategy", () => {
    /** @scenario An attack objective is required */
    it("refuses it as a field-level validation failure", async () => {
      mockGetById.mockResolvedValue({ id: "scenario_1", ...storedAttack });

      // `code`, not the sentence: the message is copy and will change, and the
      // wire message on tRPC is the code anyway.
      await expect(
        caller().update({ ...base, redTeamTarget: null }),
      ).rejects.toMatchObject({
        cause: {
          code: "validation_error",
          meta: {
            fieldErrors: { redTeamTarget: [expect.any(String)] },
          },
        },
      });
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });
});
