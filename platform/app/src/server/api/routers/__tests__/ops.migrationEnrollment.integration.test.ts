/**
 * @vitest-environment node
 *
 * The route -> service seam for the migration enrollment procedures: the ops
 * router names the migration at the boundary, stamps the acting
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
  runForOrganization: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  searchOrganizations: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
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

/** Which permission each procedure demanded, keyed by tRPC path - so a
 *  procedure wired to the wrong permission fails an assertion here instead
 *  of passing through an allow-everything stub unnoticed. */
const demandedPermissions = vi.hoisted(() => new Map<string, string>());

vi.mock("~/server/api/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/api/rbac")>();
  return {
    ...actual,
    checkOpsPermission:
      (args: { permission: string }) =>
      async ({
        ctx,
        next,
        path,
      }: {
        ctx: Record<string, unknown>;
        next: () => unknown;
        path: string;
      }) => {
        demandedPermissions.set(path, args.permission);
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
    demandedPermissions.clear();
  });

  describe("when an operator enrolls an organization", () => {
    it("delegates to the service with the acting user stamped from the session", async () => {
      service.enroll.mockResolvedValue(undefined);
      const caller = buildCaller();

      const result = await caller.enrollMigrationTenant({
        organizationId: "org_acme",
        migrationName: "authz-team-user-backfill",
      });

      expect(result).toEqual({ enrolled: true });
      expect(service.enroll).toHaveBeenCalledWith({
        organizationId: "org_acme",
        migrationName: "authz-team-user-backfill",
        actorUserId: "user_alex",
      });
      expect(demandedPermissions.get("enrollMigrationTenant")).toBe(
        "ops:manage",
      );
    });

    it("enrolls for cutover only behind its typed confirmation", async () => {
      // Cutover enrollment has the rollback's blast radius: the next pass
      // may flip which tables answer the organization's permission checks.
      service.enroll.mockResolvedValue(undefined);
      const caller = buildCaller();

      await expect(
        caller.enrollMigrationTenant({
          organizationId: "org_acme",
          migrationName: "authz-grants-cutover",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(service.enroll).not.toHaveBeenCalled();

      const result = await caller.enrollMigrationTenant({
        organizationId: "org_acme",
        migrationName: "authz-grants-cutover",
        confirm: "ENROLL",
      });
      expect(result).toEqual({ enrolled: true });
      expect(service.enroll).toHaveBeenCalledWith({
        organizationId: "org_acme",
        migrationName: "authz-grants-cutover",
        actorUserId: "user_alex",
      });
    });
  });

  describe("when an operator runs one migration for one organization", () => {
    /** @scenario "An operator runs one migration for one organization now" */
    it("delegates to the service and demands ops:manage", async () => {
      service.runForOrganization.mockResolvedValue({
        status: "finalized",
        waiting: false,
      });
      const caller = buildCaller();

      const result = await caller.runSystemMigrationForOrganization({
        organizationId: "org_acme",
        migrationName: "authz-team-user-backfill",
      });

      expect(result).toEqual({ status: "finalized" });
      expect(service.runForOrganization).toHaveBeenCalledWith({
        organizationId: "org_acme",
        migrationName: "authz-team-user-backfill",
        actorUserId: "user_alex",
      });
      expect(demandedPermissions.get("runSystemMigrationForOrganization")).toBe(
        "ops:manage",
      );
    });

    /** @scenario "A targeted cutover run takes the typed confirmation" */
    it("runs the cutover only behind its typed confirmation", async () => {
      service.runForOrganization.mockResolvedValue({
        status: "finalized",
        waiting: false,
      });
      const caller = buildCaller();

      await expect(
        caller.runSystemMigrationForOrganization({
          organizationId: "org_acme",
          migrationName: "authz-grants-cutover",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(service.runForOrganization).not.toHaveBeenCalled();

      await caller.runSystemMigrationForOrganization({
        organizationId: "org_acme",
        migrationName: "authz-grants-cutover",
        confirm: "RUN",
      });
      expect(service.runForOrganization).toHaveBeenCalledTimes(1);
    });
  });

  describe("when an operator searches organizations", () => {
    /** @scenario "An operator finds an organization by name to act on it" */
    it("delegates to the service and demands ops:view", async () => {
      service.searchOrganizations.mockResolvedValue([
        { id: "org_acme", name: "Acme Corporation" },
      ]);
      const caller = buildCaller();

      const result = await caller.searchMigrationOrganizations({
        query: "acme",
      });

      expect(result).toEqual([{ id: "org_acme", name: "Acme Corporation" }]);
      expect(service.searchOrganizations).toHaveBeenCalledWith({
        query: "acme",
      });
      expect(demandedPermissions.get("searchMigrationOrganizations")).toBe(
        "ops:view",
      );
    });
  });

  describe("when an operator withdraws an enrollment", () => {
    it("delegates to the service with the acting user stamped from the session", async () => {
      service.withdraw.mockResolvedValue(undefined);
      const caller = buildCaller();

      const result = await caller.withdrawMigrationTenant({
        organizationId: "org_acme",
        migrationName: "authz-team-user-backfill",
      });

      expect(result).toEqual({ withdrawn: true });
      expect(service.withdraw).toHaveBeenCalledWith({
        organizationId: "org_acme",
        migrationName: "authz-team-user-backfill",
        actorUserId: "user_alex",
      });
      expect(demandedPermissions.get("withdrawMigrationTenant")).toBe(
        "ops:manage",
      );
    });
  });

  describe("when the page lists enrollments", () => {
    it("answers with the service's listing untouched", async () => {
      const listing = { isSaaS: true, enrollments: [] };
      service.getEnrollments.mockResolvedValue(listing);
      const caller = buildCaller();

      await expect(caller.listMigrationEnrollments()).resolves.toEqual(listing);
      expect(demandedPermissions.get("listMigrationEnrollments")).toBe(
        "ops:view",
      );
      // The listing carries the enrollers' names, so the service audits the
      // read - the route has to say who is reading.
      expect(service.getEnrollments).toHaveBeenCalledWith({
        requestedBy: "user_alex",
      });
    });
  });
});
