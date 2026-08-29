/**
 * The transport -> service seam for the migration enrollment procedures: the
 * ops surface names the migration at the boundary, stamps the acting operator,
 * demands the right operator permission, and delegates everything else to the
 * system-migrations service.
 *
 * Corresponds to specs/migration/authz-grants-rollout.feature (the enrollment
 * scenarios).
 */
import { HandledError } from "@langwatch/handled-error";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OpsTrpcApi,
  type OpsTrpcContext,
  type OpsTrpcPorts,
} from "../src/api/app-trpc/ops.api";
import { OpsApp, type OpsCapability } from "../src/app/ops.app";

const service = {
  enroll: vi.fn<(...args: unknown[]) => Promise<void>>(),
  enrollCohort: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  withdraw: vi.fn<(...args: unknown[]) => Promise<void>>(),
  getEnrollments: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  getOverview: vi.fn(),
  startPass: vi.fn(),
  rollBack: vi.fn(),
  assertLegacyWritersDrained: vi.fn(),
  runForOrganization: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  searchOrganizations: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  // Declared by the migration itself in production, so the stub answers the way
  // the registered migrations do: only the cutover changes how the fleet
  // behaves, and only it takes the typed confirmation.
  requiresOperatorConfirmation: vi.fn(
    ({ migrationName }: { migrationName: string }) =>
      migrationName === "authz-grants-cutover",
  ),
};

const ports = {
  listPipelineRegistrations: () => ({ projections: [], eventSubscribers: [] }),
  getEventLogSearchWindow: () => ({
    searchLookbackDays: 365,
    hotTierDays: null,
    hotTierEnvVar: null,
  }),
  tryGetGrafanaLinkConfig: () => null,
  systemMigrations: service,
} satisfies OpsTrpcPorts;

/** Which permission each procedure demanded, keyed by tRPC path — so a
 *  procedure wired to the wrong permission fails an assertion here instead of
 *  passing through an allow-everything stub unnoticed. */
const demandedPermissions = new Map<string, string>();

const trpc = initTRPC.context<OpsTrpcContext>().create();

const recordingPolicy =
  (permission: "ops:view" | "ops:manage") =>
  <TProcedure>(procedure: TProcedure): TProcedure =>
    (procedure as { use(middleware: unknown): unknown }).use(
      ({ path, next }: { path: string; next: () => unknown }) => {
        demandedPermissions.set(path, permission);
        return next();
      },
    ) as TProcedure;

const router = OpsTrpcApi.create(
  trpc,
  {
    protected: trpc.procedure,
    policy: recordingPolicy,
    probePolicy: <TProcedure>(procedure: TProcedure): TProcedure => procedure,
  },
  ports,
);

/**
 * The application the migration procedures reach. Only the destructive-write
 * gate runs on it here — nothing on this surface reaches the operations
 * service, the flag store or the project index — so the composed capabilities
 * stay empty and the gate is exercised for real.
 */
function buildApp(): OpsApp {
  return OpsApp.create({
    ops: {} as OpsCapability,
    featureFlags: {} as FeatureFlagService,
    projects: { searchByQuery: async () => [] },
  });
}

/**
 * The stable code of the handled refusal a call raised.
 *
 * Asserted instead of the tRPC code because that mapping belongs to the
 * process's handled-error middleware, which this bare test root does not
 * mount: the feature raises a coded `HandledError` and the boundary decides
 * what status it becomes.
 */
async function refusalCodeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    if (HandledError.isHandled(cause)) return cause.code;
    throw error;
  }
  throw new Error("expected the call to be refused");
}

function buildCaller() {
  return router.createCaller({
    app: { ops: buildApp() },
    actor: () => ({ id: "user_alex" }),
    opsScope: { kind: "platform" },
    session: { user: { id: "user_alex", email: "staff@langwatch.ai" } },
  });
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
      expect(demandedPermissions.get("enrollMigrationTenant")).toBe("ops:manage");
    });

    it("enrolls for cutover only behind its typed confirmation", async () => {
      // Cutover enrollment has the rollback's blast radius: the next pass may
      // flip which tables answer the organization's permission checks.
      service.enroll.mockResolvedValue(undefined);
      const caller = buildCaller();

      await expect(
        refusalCodeOf(
          caller.enrollMigrationTenant({
            organizationId: "org_acme",
            migrationName: "authz-grants-cutover",
          }),
        ),
      ).resolves.toBe("ops_confirmation_required");
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

    it("refuses a confirmed cutover run from an impersonated session", async () => {
      // The audit trail names the impersonated account, which is the wrong
      // posture for a flip of this size.
      service.enroll.mockResolvedValue(undefined);
      const impersonated = router.createCaller({
        app: { ops: buildApp() },
        actor: () => ({ id: "user_customer" }),
        opsScope: { kind: "platform" },
        session: {
          user: {
            id: "user_customer",
            email: "ana@acme.com",
            impersonator: { email: "staff@langwatch.ai" },
          },
        },
      });

      await expect(
        refusalCodeOf(
          impersonated.enrollMigrationTenant({
            organizationId: "org_acme",
            migrationName: "authz-grants-cutover",
            confirm: "ENROLL",
          }),
        ),
      ).resolves.toBe("ops_impersonated_operator_refused");
      expect(service.enroll).not.toHaveBeenCalled();
    });
  });

  describe("when an operator enrolls a cohort", () => {
    /** @scenario "An operator enrolls a sampled cohort in one action" */
    it("delegates to the service with the acting user stamped from the session", async () => {
      service.enrollCohort.mockResolvedValue({
        enrolled: [{ id: "org_a", name: "A" }],
        eligibleCount: 1,
      });
      const caller = buildCaller();

      const result = await caller.enrollMigrationCohort({
        migrationName: "authz-team-user-backfill",
        sampleSize: 25,
      });

      expect(result).toEqual({
        enrolled: [{ id: "org_a", name: "A" }],
        eligibleCount: 1,
      });
      expect(service.enrollCohort).toHaveBeenCalledWith({
        migrationName: "authz-team-user-backfill",
        sampleSize: 25,
        actorUserId: "user_alex",
        // A caller that names neither gets the SAFE pool: the zod defaults are
        // what make an older client's request still mean what it did.
        includeEnterprise: false,
        includePrivateDataplane: false,
      });
      expect(demandedPermissions.get("enrollMigrationCohort")).toBe("ops:manage");
    });

    /** @scenario "An operator can draw enterprise organizations into a cohort" */
    it("passes a lifted exclusion through to the service", async () => {
      service.enrollCohort.mockResolvedValue({ enrolled: [], eligibleCount: 0 });
      const caller = buildCaller();

      await caller.enrollMigrationCohort({
        migrationName: "authz-team-user-backfill",
        sampleSize: 25,
        includeEnterprise: true,
      });

      expect(service.enrollCohort).toHaveBeenCalledWith(
        expect.objectContaining({
          includeEnterprise: true,
          // Lifting one leaves the other alone, at the transport as well as in
          // the service.
          includePrivateDataplane: false,
        }),
      );
    });

    /** @scenario "A cutover cohort takes the typed confirmation" */
    it("enrolls a cutover cohort only behind its typed confirmation", async () => {
      service.enrollCohort.mockResolvedValue({ enrolled: [], eligibleCount: 0 });
      const caller = buildCaller();

      await expect(
        refusalCodeOf(
          caller.enrollMigrationCohort({
            migrationName: "authz-grants-cutover",
            sampleSize: 10,
          }),
        ),
      ).resolves.toBe("ops_confirmation_required");
      expect(service.enrollCohort).not.toHaveBeenCalled();

      await caller.enrollMigrationCohort({
        migrationName: "authz-grants-cutover",
        sampleSize: 10,
        confirm: "ENROLL",
      });
      expect(service.enrollCohort).toHaveBeenCalledWith({
        migrationName: "authz-grants-cutover",
        sampleSize: 10,
        actorUserId: "user_alex",
        includeEnterprise: false,
        includePrivateDataplane: false,
      });
    });
  });

  describe("when an operator runs one migration for one organization", () => {
    /** @scenario "An operator runs the migration for one organization now" */
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

      expect(result).toEqual({ status: "finalized", waiting: false });
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
        refusalCodeOf(
          caller.runSystemMigrationForOrganization({
            organizationId: "org_acme",
            migrationName: "authz-grants-cutover",
          }),
        ),
      ).resolves.toBe("ops_confirmation_required");
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

      const result = await caller.searchMigrationOrganizations({ query: "acme" });

      expect(result).toEqual([{ id: "org_acme", name: "Acme Corporation" }]);
      expect(service.searchOrganizations).toHaveBeenCalledWith({ query: "acme" });
      expect(demandedPermissions.get("searchMigrationOrganizations")).toBe("ops:view");
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
      expect(demandedPermissions.get("withdrawMigrationTenant")).toBe("ops:manage");
    });
  });

  describe("when the page lists enrollments", () => {
    it("answers with the service's listing untouched", async () => {
      const listing = { isSaaS: true, enrollments: [] };
      service.getEnrollments.mockResolvedValue(listing);
      const caller = buildCaller();

      await expect(caller.listMigrationEnrollments()).resolves.toEqual(listing);
      expect(demandedPermissions.get("listMigrationEnrollments")).toBe("ops:view");
      // The listing carries the enrollers' names, so the service audits the
      // read — the transport has to say who is reading.
      expect(service.getEnrollments).toHaveBeenCalledWith({
        requestedBy: "user_alex",
      });
    });
  });
});
