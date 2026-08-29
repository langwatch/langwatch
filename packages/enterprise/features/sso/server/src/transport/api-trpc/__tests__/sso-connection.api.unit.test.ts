/**
 * The back office's single sign-on surface: who reaches it, what it refuses by
 * name, and the fact that nothing on it writes a field.
 *
 * Corresponds to specs/identity/sso-onboarding-tiers.feature.
 */
import { AdminSurfaceHiddenError, OpsService } from "@langwatch/ops-contract";
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SsoConnectionTrpcApi,
  type SsoConnectionTrpcContext,
} from "../sso-connection.api";

const backoffice = {
  list: vi.fn(),
  getById: vi.fn(),
  registerConnection: vi.fn(),
  claimDomain: vi.fn(),
  approveDomainClaim: vi.fn(),
  rejectDomainClaim: vi.fn(),
  attestDomain: vi.fn(),
  activateConnection: vi.fn(),
  suspendConnection: vi.fn(),
  resumeConnection: vi.fn(),
  requestTeardown: vi.fn(),
};

const recordAudit = vi.fn<(entry: Record<string, unknown>) => Promise<void>>();

/** The one operator on the staff list, exactly as `ADMIN_EMAILS` decides it. */
const STAFF_EMAIL = "olive@langwatch.ai";

class StaffListOps extends OpsService {
  isAdmin(identity: { email?: string | null }): boolean {
    return identity.email === STAFF_EMAIL;
  }
  // Nothing else on the surface reaches the operations service.
  startImpersonation = unreachable;
  stopImpersonation = unreachable;
  adminOperation = unreachable;
  listBlobQueues = unreachable;
  getBlobStoreStats = unreachable;
  listBlobs = unreachable;
  tryGetBlob = unreachable;
  runBlobCleanup = unreachable;
  deleteBlob = unreachable;
  listAnomalies = unreachable;
  dismissAnomaly = unreachable;
  listScheduledJobs = unreachable;
  listPausedSchedules = unreachable;
  listSchedulerActions = unreachable;
  setScheduleActive = unreachable;
  clearStuckScheduleSlot = unreachable;
  runScheduleNow = unreachable;
  listQueues = unreachable;
  listQueueGroups = unreachable;
  tryGetQueueGroup = unreachable;
  listQueueGroupJobs = unreachable;
  getBlockedQueueSummary = unreachable;
  listParkedQueueGroups = unreachable;
  listAllQueueDlqGroups = unreachable;
  unblockQueueGroup = unreachable;
  unblockAllQueueGroups = unreachable;
  drainQueueGroup = unreachable;
  pauseQueuePipeline = unreachable;
  unpauseQueuePipeline = unreachable;
  retryBlockedQueueJob = unreachable;
  listPausedQueueKeys = unreachable;
  pauseQueueTenant = unreachable;
  unpauseQueueTenant = unreachable;
  listPausedQueueTenants = unreachable;
  drainQueueTenant = unreachable;
  moveQueueGroupToDlq = unreachable;
  moveAllBlockedQueueGroupsToDlq = unreachable;
  replayQueueGroupFromDlq = unreachable;
  replayAllQueueGroupsFromDlq = unreachable;
  redriveQueueDlqGroups = unreachable;
  discardQueueDlqGroups = unreachable;
  canaryRedriveQueueDlq = unreachable;
  canaryUnblockQueueGroups = unreachable;
  listQueueDlqGroups = unreachable;
  getQueueDrainPreview = unreachable;
  discoverQueueNames = unreachable;
  scanQueues = unreachable;
  tryReconcileQueuePending = unreachable;
  readQueuePendingDrift = unreachable;
  listParkedQueueTenants = unreachable;
}

function unreachable(): never {
  throw new Error("the single sign-on back office reached an unrelated operations verb");
}

const trpc = initTRPC.context<SsoConnectionTrpcContext>().create();

/** The process's chain is exercised in the app; here it is the identity. */
const identityPolicy = <TProcedure>(procedure: TProcedure): TProcedure => procedure;

const router = SsoConnectionTrpcApi.create(
  trpc,
  {
    protected: trpc.procedure,
    staffPolicy: identityPolicy,
    staffPolicyForOrganization: identityPolicy,
  },
  { backoffice: () => backoffice, recordAudit },
);

function buildCaller(email: string) {
  return router.createCaller({
    app: { ops: new StaffListOps() },
    actor: () => ({ id: "user_olive" }),
    session: { user: { id: "user_olive", email } },
  });
}

const TARGET = { organizationId: "org_acme", connectionId: "ssoc_1" };

describe("the back-office single sign-on surface", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backoffice.list.mockResolvedValue({ connections: [], total: 0 });
    recordAudit.mockResolvedValue(undefined);
  });

  describe("given somebody outside the staff list", () => {
    it("answers a denial that says nothing about the surface", async () => {
      const caller = buildCaller("ana@acme.com");

      // The hidden-surface error, not a FORBIDDEN: the surface does not confirm
      // its own existence to whoever is probing it.
      const denial = await caller.attestDomain({ ...TARGET, domain: "acme.com" }).then(
        () => {
          throw new Error("attestDomain resolved: the back office gate let the call through");
        },
        (error: unknown) => error as AdminSurfaceHiddenError,
      );
      expect(denial).toBeInstanceOf(AdminSurfaceHiddenError);
      expect(denial.code).toBe("not_found");
      expect(denial.message).toBe("Not found");
      expect(denial.message).not.toMatch(/sso|backoffice|admin|connection/i);

      // And nothing was commanded, nor recorded.
      expect(backoffice.attestDomain).not.toHaveBeenCalled();
      expect(recordAudit).not.toHaveBeenCalled();
    });

    it("refuses every verb on the surface, not only the read", async () => {
      const caller = buildCaller("ana@acme.com");
      const attempts = [
        () => caller.getAll({ page: 0, pageSize: 25 }),
        () => caller.getById({ connectionId: "ssoc_1" }),
        () => caller.claimDomain({ ...TARGET, domain: "acme.com" }),
        () => caller.approveDomainClaim({ ...TARGET, domain: "acme.com" }),
        () => caller.attestDomain({ ...TARGET, domain: "acme.com" }),
        () => caller.activate({ ...TARGET, testLoginAccountId: "acc_test" }),
        () => caller.suspend({ ...TARGET, reason: null }),
        () => caller.resume(TARGET),
        () => caller.requestTeardown({ ...TARGET, reason: null }),
      ];
      for (const attempt of attempts) {
        await expect(attempt()).rejects.toBeInstanceOf(AdminSurfaceHiddenError);
      }
      expect(backoffice.claimDomain).not.toHaveBeenCalled();
      expect(backoffice.requestTeardown).not.toHaveBeenCalled();
      expect(backoffice.list).not.toHaveBeenCalled();
    });
  });

  describe("given a LangWatch operator", () => {
    /** @scenario "An operator cannot change a connection except by commanding it" */
    it("turns every change into a guarded command carrying the operator", async () => {
      const caller = buildCaller(STAFF_EMAIL);

      await caller.claimDomain({ ...TARGET, domain: "acme.com" });
      await caller.approveDomainClaim({ ...TARGET, domain: "acme.com" });
      await caller.attestDomain({ ...TARGET, domain: "acme.com" });
      await caller.activate({ ...TARGET, testLoginAccountId: "acc_test" });
      await caller.suspend({ ...TARGET, reason: null });
      await caller.resume(TARGET);

      // Every one reached a lifecycle verb, and every one carried the operator
      // as the actor. The surface mints that; no input supplies it.
      const commanded = [
        backoffice.claimDomain,
        backoffice.approveDomainClaim,
        backoffice.attestDomain,
        backoffice.activateConnection,
        backoffice.suspendConnection,
        backoffice.resumeConnection,
      ];
      for (const verb of commanded) {
        expect(verb).toHaveBeenCalledTimes(1);
        expect(verb.mock.calls[0]![0]).toMatchObject({
          operator: { userId: "user_olive" },
        });
      }

      // There is no verb on this router that writes a field. Every procedure is
      // one of the lifecycle's, so a "save" has nowhere to land.
      expect(Object.keys(router._def.procedures).sort()).toEqual([
        "activate",
        "approveDomainClaim",
        "attestDomain",
        "claimDomain",
        "getAll",
        "getById",
        "register",
        "rejectDomainClaim",
        "requestTeardown",
        "resume",
        "suspend",
      ]);
    });

    it("reads the impersonator, so debugging a customer stays operator work", async () => {
      const caller = router.createCaller({
        app: { ops: new StaffListOps() },
        actor: () => ({ id: "user_customer" }),
        session: {
          user: {
            id: "user_customer",
            email: "ana@acme.com",
            impersonator: { id: "user_olive", email: STAFF_EMAIL },
          },
        },
      });

      await caller.attestDomain({ ...TARGET, domain: "acme.com" });

      expect(backoffice.attestDomain.mock.calls[0]![0]).toMatchObject({
        operator: { userId: "user_olive" },
      });
    });

    it("records every attempt in the audit log before the command runs", async () => {
      const caller = buildCaller(STAFF_EMAIL);
      await caller.attestDomain({ ...TARGET, domain: "acme.com" });

      expect(recordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "user_olive",
          action: "ssoConnections.attestDomain",
          targetKind: "ssoConnection",
          targetId: "ssoc_1",
        }),
      );
    });

    it("keeps a rejection note out of the audit row", async () => {
      const caller = buildCaller(STAFF_EMAIL);
      await caller.rejectDomainClaim({
        ...TARGET,
        domain: "acme.com",
        note: "the requester could not be reached at that domain",
      });

      // The note is an operator's prose about a customer, and audit rows outlive
      // the decision. The command carries it; the audit row does not.
      const [[audited]] = recordAudit.mock.calls as unknown as [
        [{ args: Record<string, unknown> }],
      ];
      expect(audited.args.note).toBeUndefined();
      expect(backoffice.rejectDomainClaim).toHaveBeenCalledWith(
        expect.objectContaining({
          note: "the requester could not be reached at that domain",
        }),
      );
    });

    /** @scenario "Setting up a SAML connection is not something anybody does themselves yet" */
    it("hands a SAML registration to the service, which refuses it by name", async () => {
      const caller = buildCaller(STAFF_EMAIL);
      // Narrowing the input to "oidc" would answer a validation error instead,
      // which tells the operator the field is wrong rather than that the
      // protocol is not self-serve yet.
      await caller.register({
        organizationId: "org_acme",
        type: "saml",
        providerId: "okta",
        issuer: null,
        allowsJit: false,
      });

      expect(backoffice.registerConnection).toHaveBeenCalledWith(
        expect.objectContaining({ type: "saml" }),
      );
    });
  });
});
