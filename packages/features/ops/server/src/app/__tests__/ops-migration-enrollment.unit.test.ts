/**
 * @vitest-environment node
 *
 * The transport -> application seam for the migration enrollment procedures:
 * the surface names the migration, stamps the acting operator, demands the
 * right grain, and delegates the rest to the runner the process supplies.
 * Spec: specs/migration/authz-grants-rollout.feature.
 */
import { bindTrpcFact, createTrpcRuntime } from "@langwatch/api/trpc";
import { HandledError } from "@langwatch/handled-error";
import type { OpsOperator } from "@langwatch/ops-contract";
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createOpsTestApp, OPS_STAFF_ADDRESS } from "./ops.fixture.ts";
import type { OpsSystemMigrationRunner } from "../ops.app.ts";
import { opsOperatorFact } from "../../transport/ops-operator.trpc.ts";
import { opsPlatformTrpcTransport } from "../../transport/ops-platform.trpc.ts";
import { opsTrpcTestPorts } from "../../transport/__tests__/ops.trpc.harness.ts";

/**
 * Every stub is typed from the runner itself. A stub typed
 * `(...args: unknown[])` accepts any call and resolves any value, so this
 * suite would keep passing while the browser read fields off nothing.
 */
const service = {
  enroll: vi.fn<OpsSystemMigrationRunner["enroll"]>(),
  enrollCohort: vi.fn<OpsSystemMigrationRunner["enrollCohort"]>(),
  withdraw: vi.fn<OpsSystemMigrationRunner["withdraw"]>(),
  getEnrollments: vi.fn<OpsSystemMigrationRunner["getEnrollments"]>(),
  getOverview: vi.fn<OpsSystemMigrationRunner["getOverview"]>(),
  startPass: vi.fn<OpsSystemMigrationRunner["startPass"]>(),
  rollBack: vi.fn<OpsSystemMigrationRunner["rollBack"]>(),
  assertLegacyWritersDrained: vi.fn<OpsSystemMigrationRunner["assertLegacyWritersDrained"]>(),
  runForOrganization: vi.fn<OpsSystemMigrationRunner["runForOrganization"]>(),
  searchOrganizations: vi.fn<OpsSystemMigrationRunner["searchOrganizations"]>(),
  // Declared by the migration itself in production, so the stub answers the way
  // the registered migrations do: only the cutover changes how the fleet
  // behaves, and only it takes the typed confirmation.
  requiresOperatorConfirmation: vi.fn(
    ({ migrationName }: { migrationName: string }) => migrationName === "authz-grants-cutover",
  ),
} satisfies OpsSystemMigrationRunner;

type MigrationTestContext = { actor: { id: string }; operator: OpsOperator | null };

const OPERATOR: OpsOperator = { id: "user_alex", email: OPS_STAFF_ADDRESS };
const IMPERSONATING: OpsOperator = {
  id: "user_customer",
  email: "ana@acme.com",
  impersonator: { email: OPS_STAFF_ADDRESS },
};

/**
 * Which grain each procedure demanded, keyed by the name it was called under -
 * so a procedure wired to the wrong grain fails an assertion here instead of
 * passing through an allow-everything stub unnoticed.
 */
const demandedPermissions = new Map<string, string>();

function callerFor(operator: OpsOperator) {
  const { app } = createOpsTestApp({ infrastructure: { systemMigrations: service } });
  const admitOperator = app.admitOperator.bind(app);
  let current = "";

  vi.spyOn(app, "admitOperator").mockImplementation((asked, permission) => {
    demandedPermissions.set(current, permission);

    return admitOperator(asked, permission);
  });

  const trpc = initTRPC.context<MigrationTestContext>().create();
  const router = createTrpcRuntime<MigrationTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    ports: opsTrpcTestPorts(),
  }).mount(opsPlatformTrpcTransport, () => app, {
    facts: [bindTrpcFact(opsOperatorFact, (ctx: MigrationTestContext) => ctx.operator)],
  });

  // The name the grain is recorded under: tRPC hands the handler no path, and
  // the application is what the grain is asked of.
  const named = new Proxy(
    router.createCaller({ actor: { id: operator.id }, operator }),
    {
      get: (target, property: string) => {
        const procedure = Reflect.get(target, property) as unknown;

        if (typeof procedure !== "function") return procedure;

        return (...args: unknown[]) => {
          current = property;

          return (procedure as (...values: unknown[]) => unknown).call(target, ...args);
        };
      },
    },
  );

  return named;
}

function buildCaller() {
  return callerFor(OPERATOR);
}

/**
 * The stable code of the handled refusal a call raised.
 *
 * Asserted instead of the tRPC code because that mapping belongs to the
 * boundary's own status table: the feature raises a coded `HandledError` and
 * the boundary decides what status it becomes.
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
      const impersonated = callerFor(IMPERSONATING);

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
      expect(demandedPermissions.get("runSystemMigrationForOrganization")).toBe("ops:manage");
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
      service.searchOrganizations.mockResolvedValue([{ id: "org_acme", name: "Acme Corporation" }]);
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
      // read - the transport has to say who is reading.
      expect(service.getEnrollments).toHaveBeenCalledWith({
        requestedBy: "user_alex",
      });
    });
  });
});
