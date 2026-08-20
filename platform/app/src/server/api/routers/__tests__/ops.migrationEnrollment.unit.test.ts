/**
 * @vitest-environment node
 *
 * The route -> service seam for the migration enrollment procedures: the ops
 * router validates the stage vocabulary at the boundary, stamps the acting
 * user from the session, and delegates everything else to
 * `systemMigrationsService`. Corresponds to
 * specs/rbac/in-place-authz-migration.feature (the enrollment scenarios).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";

const service = vi.hoisted(() => ({
  enroll: vi.fn<(...args: unknown[]) => Promise<void>>(),
  withdraw: vi.fn<(...args: unknown[]) => Promise<void>>(),
  getEnrollments: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  getOverview: vi.fn(),
  startPass: vi.fn(),
  rollBack: vi.fn(),
}));

vi.mock("~/server/app-layer/system-migrations/runtime", () => ({
  systemMigrationsService: service,
}));

// The tRPC audit middleware writes through the real Prisma client; without
// this stub the suite only passes on a machine whose dev Postgres happens to
// answer. Same stub every sibling router test carries.
vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/server/api/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/api/rbac")>();
  return {
    ...actual,
    checkOpsPermission:
      () =>
      async ({
        ctx,
        next,
      }: {
        ctx: Record<string, unknown>;
        next: () => unknown;
      }) => {
        ctx.opsScope = { kind: "platform" };
        return next();
      },
  };
});

import { opsRouter } from "../ops";

function buildCaller() {
  const ctx = createInnerTRPCContext({
    session: {
      user: { id: "user_alex", email: "staff@langwatch.ai" },
      expires: "1",
    },
    req: undefined,
    res: undefined,
    permissionChecked: true,
    publiclyShared: false,
  });
  return opsRouter.createCaller(ctx);
}

describe("ops migration enrollment procedures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when an operator enrolls an organization", () => {
    it("delegates to the service with the acting user stamped from the session", async () => {
      service.enroll.mockResolvedValue(undefined);
      const caller = buildCaller();

      const result = await caller.enrollMigrationTenant({
        organizationId: "org_acme",
        stage: "cutover",
      });

      expect(result).toEqual({ enrolled: true });
      expect(service.enroll).toHaveBeenCalledWith({
        organizationId: "org_acme",
        stage: "cutover",
        actorUserId: "user_alex",
      });
    });

    it("refuses a stage outside the vocabulary at the boundary", async () => {
      const caller = buildCaller();

      await expect(
        caller.enrollMigrationTenant({
          organizationId: "org_acme",
          // Deliberately invalid input - the router's schema must refuse it.
          stage: "everything" as unknown as "migrations",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(service.enroll).not.toHaveBeenCalled();
    });
  });

  describe("when an operator withdraws an enrollment", () => {
    it("delegates to the service with the acting user stamped from the session", async () => {
      service.withdraw.mockResolvedValue(undefined);
      const caller = buildCaller();

      const result = await caller.withdrawMigrationTenant({
        organizationId: "org_acme",
        stage: "migrations",
      });

      expect(result).toEqual({ withdrawn: true });
      expect(service.withdraw).toHaveBeenCalledWith({
        organizationId: "org_acme",
        stage: "migrations",
        actorUserId: "user_alex",
      });
    });
  });

  describe("when the page lists enrollments", () => {
    it("answers with the service's listing untouched", async () => {
      const listing = { isSaaS: true, enrollments: [] };
      service.getEnrollments.mockResolvedValue(listing);
      const caller = buildCaller();

      await expect(caller.listMigrationEnrollments()).resolves.toEqual(listing);
    });
  });
});
