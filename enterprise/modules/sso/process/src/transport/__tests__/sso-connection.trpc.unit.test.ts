import { createApiFixture } from "@langwatch/api-fixture";
/**
 * @vitest-environment node
 * Who reaches the back office's single sign-on surface, what it refuses by name,
 * and that nothing on it writes a field (specs/identity/sso-onboarding-tiers).
 */
import { createTrpcRuntime, type TrpcRuntimeMembers } from "@langwatch/api/trpc";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type {
  SsoConnectionBackofficeApi,
  SsoConnectionHistoryApi,
  SsoSetupApi,
} from "@langwatch/identity-contract";
import { AdminSurfaceHiddenError } from "@langwatch/ops-contract";
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSsoTestApp,
  createSsoTestIdentity,
  createSsoTestUsers,
  RecordingSsoConnectionLedger,
  RecordingSsoSetupCommands,
  SSO_TEST_STAFF_EMAIL,
} from "../../app/__tests__/sso.fixture.ts";
import { ssoConnectionTrpcTransport } from "../sso-connection.trpc.ts";

const STAFF_ID = "user_olive";
const CUSTOMER_ID = "user_customer";

type TestContext = { actor: { id: string; impersonatorId?: string } };

/**
 * The domain error a procedure threw, out from under tRPC's wrapper: a thrown
 * `AdminSurfaceHiddenError` arrives as a `TRPCError` carrying it as `cause`,
 * which is where `createTrpcErrorFormatter` looks for it in the real app.
 */
function domainErrorOf(error: unknown): unknown {
  return (error as { cause?: unknown }).cause ?? error;
}

function runtimePorts(): TrpcRuntimeMembers<TestContext> {
  return {
    identity: {
      caller: (ctx) => ({
        actor: {
          type: "user",
          id: ctx.actor.id,
          ...(ctx.actor.impersonatorId === undefined
            ? {}
            : { impersonatorId: ctx.actor.impersonatorId }),
        },
      }),
    },
    authorization: {
      forRequest: () => ({
        getDecision: async () => ({ permitted: true, organizationRole: null }),
        getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };
}

async function harness() {
  const connections = RecordingSsoConnectionLedger.create();
  const record = vi.fn<AuditLogApi["record"]>(async () => ({ id: "audit", occurredAt: 0 }));
  const getHistory = vi.fn<SsoConnectionHistoryApi["getHistory"]>(async () => [
    { eventId: "evt_1", occurredAtMs: 1, summary: "Registered", carriedOver: false },
  ]);
  const getMigrationProgress = vi.fn<SsoSetupApi["getMigrationProgress"]>(async () => ({
    migration: null,
  }));
  const commands = RecordingSsoSetupCommands.create();
  const app = await createSsoTestApp({
    connections,
    dependencies: {
      identity: createSsoTestIdentity({
        connections,
        history: createApiFixture<SsoConnectionHistoryApi>({ getHistory }),
        setup: createApiFixture<SsoSetupApi>({ getMigrationProgress }),
        commands,
      }),
      users: createSsoTestUsers({
        [STAFF_ID]: SSO_TEST_STAFF_EMAIL,
        [CUSTOMER_ID]: "ana@acme.com",
      }),
      auditLog: { record, listEntityHistory: async () => [], hasRecordedSince: async () => false },
    },
  });

  const trpc = initTRPC.context<TestContext>().create();
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: runtimePorts(),
  }).mount(ssoConnectionTrpcTransport, () => app);

  const callerFor = (actor: TestContext["actor"]) => router.createCaller({ actor });

  return { connections, record, router, callerFor, getHistory, getMigrationProgress, commands };
}

const TARGET = { organizationId: "org_acme", connectionId: "ssoc_1" };
const EVIDENCE = { evidenceRef: "ticket:SEC-123", note: "Signed contract names acme.com" };
const IDP = {
  protocol: "oidc",
  issuer: "https://acme.okta.com",
  clientId: "client",
  clientSecret: "shhh",
} as const;

type BackofficeConnection = NonNullable<
  Awaited<ReturnType<SsoConnectionBackofficeApi["findById"]>>
>;

function legacyConnection(organizationId: string): BackofficeConnection {
  return {
    connectionId: "ssoc_1",
    organizationId,
    organizationName: "Acme",
    type: "oidc",
    state: "ACTIVE",
    claimedDomains: [],
    approvedDomains: [],
    verifiedDomains: ["acme.com"],
    domainVerifications: [],
    providerId: "okta",
    issuer: null,
    allowsJit: false,
    arrivalPolicy: "refuse",
    source: "legacy-grandfathered",
    testLoginAccountId: null,
    rejection: null,
    pendingVerificationDomain: null,
    pendingVerificationExpiresAtMs: null,
    createdAtMs: 0,
    updatedAtMs: 0,
  };
}

describe("the back-office single sign-on surface", () => {
  let context: Awaited<ReturnType<typeof harness>>;

  beforeEach(async () => {
    context = await harness();
  });

  describe("given somebody outside the staff list", () => {
    it("answers a denial that says nothing about the surface", async () => {
      const caller = context.callerFor({ id: CUSTOMER_ID });

      // The hidden-surface error, not a FORBIDDEN: the surface does not confirm
      // its own existence to whoever is probing it.
      const denial = await caller.attestDomain({ ...TARGET, ...EVIDENCE, domain: "acme.com" }).then(
        () => {
          throw new Error("attestDomain resolved: the back office gate let the call through");
        },
        (error: unknown) => domainErrorOf(error) as AdminSurfaceHiddenError,
      );
      expect(denial).toBeInstanceOf(AdminSurfaceHiddenError);
      expect(denial.code).toBe("not_found");
      expect(denial.message).toBe("Not found");
      expect(denial.message).not.toMatch(/sso|backoffice|admin|connection/i);

      // And nothing was commanded, nor recorded.
      expect(context.connections.attestDomain).not.toHaveBeenCalled();
      expect(context.record).not.toHaveBeenCalled();
    });

    it("refuses every verb on the surface, not only the read", async () => {
      const caller = context.callerFor({ id: CUSTOMER_ID });
      const attempts = [
        () => caller.getAll({ page: 0, pageSize: 25 }),
        () => caller.getById({ connectionId: "ssoc_1" }),
        () => caller.getHistory({ connectionId: "ssoc_1" }),
        () => caller.getMigrationProgress({ connectionId: "ssoc_1" }),
        () =>
          caller.startLegacyMigration({
            organizationId: "org_acme",
            legacyConnectionId: "ssoc_1",
            providerId: "okta-direct",
            idp: IDP,
          }),
        () => caller.claimDomain({ ...TARGET, domain: "acme.com" }),
        () => caller.approveDomainClaim({ ...TARGET, domain: "acme.com" }),
        () => caller.attestDomain({ ...TARGET, ...EVIDENCE, domain: "acme.com" }),
        () => caller.activate({ ...TARGET, testLoginAccountId: "acc_test" }),
        () => caller.suspend({ ...TARGET, reason: null }),
        () => caller.resume(TARGET),
        () => caller.requestTeardown({ ...TARGET, reason: null }),
      ];
      for (const attempt of attempts) {
        const refusal = await attempt().then(() => {
          throw new Error("the back office gate let a call through");
        }, domainErrorOf);
        expect(refusal).toBeInstanceOf(AdminSurfaceHiddenError);
      }
      expect(context.connections.claimDomain).not.toHaveBeenCalled();
      expect(context.connections.requestTeardown).not.toHaveBeenCalled();
      expect(context.connections.list).not.toHaveBeenCalled();
      expect(context.connections.findById).not.toHaveBeenCalled();
      expect(context.commands.startLegacyMigration).not.toHaveBeenCalled();
    });
  });

  describe("given a LangWatch operator", () => {
    /** @scenario "An operator cannot change a connection except by commanding it" */
    it("turns every change into a guarded command carrying the operator", async () => {
      const caller = context.callerFor({ id: STAFF_ID });

      await caller.claimDomain({ ...TARGET, domain: "acme.com" });
      await caller.approveDomainClaim({ ...TARGET, domain: "acme.com" });
      await caller.attestDomain({ ...TARGET, ...EVIDENCE, domain: "acme.com" });
      await caller.activate({ ...TARGET, testLoginAccountId: "acc_test" });
      await caller.suspend({ ...TARGET, reason: null });
      await caller.resume(TARGET);

      // Every one reached a lifecycle verb, and every one carried the operator
      // as the actor. The surface mints that; no input supplies it.
      const commanded = [
        context.connections.claimDomain,
        context.connections.approveDomainClaim,
        context.connections.attestDomain,
        context.connections.activateConnection,
        context.connections.suspendConnection,
        context.connections.resumeConnection,
      ];
      for (const verb of commanded) {
        expect(verb).toHaveBeenCalledTimes(1);
        expect(verb.mock.calls[0]![0]).toMatchObject({ operator: { userId: STAFF_ID } });
      }

      // There is no verb on this router that writes a field. Every procedure is
      // one of the lifecycle's, so a "save" has nowhere to land.
      expect(Object.keys(context.router._def.procedures).toSorted()).toEqual([
        "activate",
        "approveDomainClaim",
        "attestDomain",
        "claimDomain",
        "getAll",
        "getById",
        "getHistory",
        "getMigrationProgress",
        "register",
        "rejectDomainClaim",
        "requestTeardown",
        "resume",
        "startLegacyMigration",
        "suspend",
      ]);
    });

    it("reads the impersonator, so debugging a customer stays operator work", async () => {
      const caller = context.callerFor({ id: CUSTOMER_ID, impersonatorId: STAFF_ID });

      await caller.attestDomain({ ...TARGET, ...EVIDENCE, domain: "acme.com" });

      expect(context.connections.attestDomain.mock.calls[0]![0]).toMatchObject({
        operator: { userId: STAFF_ID },
      });
    });

    it("records the command in the audit log", async () => {
      const caller = context.callerFor({ id: STAFF_ID });
      await caller.attestDomain({ ...TARGET, ...EVIDENCE, domain: "acme.com" });

      expect(context.record).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: STAFF_ID,
          action: "ssoConnections.attestDomain",
          organizationId: "org_acme",
          args: expect.objectContaining({
            targetKind: "ssoConnection",
            targetId: "ssoc_1",
          }),
        }),
      );
    });

    it("keeps a rejection note out of the audit row", async () => {
      const caller = context.callerFor({ id: STAFF_ID });
      await caller.rejectDomainClaim({
        ...TARGET,
        domain: "acme.com",
        note: "the requester could not be reached at that domain",
      });

      // The note is an operator's prose about a customer, and audit rows outlive
      // the decision. The command carries it; the audit row does not.
      const audited = context.record.mock.calls[0]?.[0];
      expect(audited?.args).toBeDefined();
      expect(audited?.args).not.toHaveProperty("note");
      expect(context.connections.rejectDomainClaim).toHaveBeenCalledWith(
        expect.objectContaining({
          note: "the requester could not be reached at that domain",
        }),
      );
    });

    it("audits an attestation's evidence and keeps its note out of the row", async () => {
      const caller = context.callerFor({ id: STAFF_ID });
      await caller.attestDomain({ ...TARGET, ...EVIDENCE, domain: "acme.com" });

      const audited = context.record.mock.calls[0]?.[0];
      expect(audited?.args).toMatchObject({ evidenceRef: "ticket:SEC-123" });
      expect(audited?.args).not.toHaveProperty("note");
      expect(context.connections.attestDomain).toHaveBeenCalledWith(
        expect.objectContaining({ evidenceRef: "ticket:SEC-123", note: EVIDENCE.note }),
      );
    });

    it("refuses an attestation without evidence before the ledger is asked", async () => {
      const caller = context.callerFor({ id: STAFF_ID });

      await expect(
        caller.attestDomain({
          ...TARGET,
          domain: "acme.com",
          evidenceRef: " ",
          note: EVIDENCE.note,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(context.connections.attestDomain).not.toHaveBeenCalled();
    });

    /** @scenario "Setting up a SAML connection is not something anybody does themselves yet" */
    it("hands a SAML registration to the ledger, which refuses it by name", async () => {
      const caller = context.callerFor({ id: STAFF_ID });
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

      expect(context.connections.registerConnection).toHaveBeenCalledWith(
        expect.objectContaining({ type: "saml" }),
      );
    });

    it("carries the stated arrival answer, so it is not decided by the legacy boolean", async () => {
      const caller = context.callerFor({ id: STAFF_ID });
      await caller.register({
        organizationId: "org_acme",
        type: "oidc",
        providerId: "okta",
        issuer: null,
        allowsJit: false,
        arrivalPolicy: "request",
      });

      expect(context.connections.registerConnection).toHaveBeenCalledWith(
        expect.objectContaining({ arrivalPolicy: "request", allowsJit: false }),
      );
    });

    it("carries the seven-day reversal window on a teardown request", async () => {
      const caller = context.callerFor({ id: STAFF_ID });
      await caller.requestTeardown({ ...TARGET, reason: null });

      expect(context.connections.requestTeardown).toHaveBeenCalledWith(
        expect.objectContaining({ graceMs: 7 * 24 * 60 * 60 * 1000 }),
      );
    });
  });
  describe("given an operator reading and moving a customer's connection", () => {
    it("answers null history for a connection that does not exist", async () => {
      const caller = context.callerFor({ id: STAFF_ID });

      await expect(caller.getHistory({ connectionId: "ssoc_missing" })).resolves.toBeNull();
      expect(context.getHistory).not.toHaveBeenCalled();
    });

    it("reads the history under the connection's own organization and audits it", async () => {
      context.connections.findById.mockResolvedValue(legacyConnection("org_acme"));
      const caller = context.callerFor({ id: STAFF_ID });

      const history = await caller.getHistory({ connectionId: "ssoc_1" });

      expect(history).toEqual([
        { eventId: "evt_1", occurredAtMs: 1, summary: "Registered", carriedOver: false },
      ]);
      expect(context.getHistory).toHaveBeenCalledWith({
        organizationId: "org_acme",
        connectionId: "ssoc_1",
      });
      expect(context.record).toHaveBeenCalledWith(
        expect.objectContaining({ userId: STAFF_ID, action: "ssoConnections.getHistory" }),
      );
    });

    it("pages a cutover with main's defaults, and answers null for a missing connection", async () => {
      const caller = context.callerFor({ id: STAFF_ID });
      await expect(
        caller.getMigrationProgress({ connectionId: "ssoc_missing" }),
      ).resolves.toBeNull();
      expect(context.getMigrationProgress).not.toHaveBeenCalled();

      context.connections.findById.mockResolvedValue(legacyConnection("org_acme"));
      await caller.getMigrationProgress({ connectionId: "ssoc_1" });

      expect(context.getMigrationProgress).toHaveBeenCalledWith({
        organizationId: "org_acme",
        connectionId: "ssoc_1",
        cursor: null,
        limit: 50,
      });
    });

    it("registers the replacement with the operator as the actor", async () => {
      context.connections.findById.mockResolvedValue(legacyConnection("org_acme"));
      const caller = context.callerFor({ id: STAFF_ID });

      await expect(
        caller.startLegacyMigration({
          organizationId: "org_acme",
          legacyConnectionId: "ssoc_1",
          providerId: "okta-direct",
          idp: IDP,
        }),
      ).resolves.toEqual({ connectionId: "conn-replacement" });

      expect(context.commands.startLegacyMigration).toHaveBeenCalledWith({
        organizationId: "org_acme",
        legacyConnectionId: "ssoc_1",
        providerId: "okta-direct",
        registration: IDP,
        actor: { userId: STAFF_ID },
      });
      const audited = context.record.mock.calls[0]?.[0];
      expect(audited?.args).not.toHaveProperty("idp");
    });

    it("refuses a legacy connection that belongs to another organization as not found", async () => {
      context.connections.findById.mockResolvedValue(legacyConnection("org_other"));
      const caller = context.callerFor({ id: STAFF_ID });

      await expect(
        caller.startLegacyMigration({
          organizationId: "org_acme",
          legacyConnectionId: "ssoc_1",
          providerId: "okta-direct",
          idp: IDP,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(context.commands.startLegacyMigration).not.toHaveBeenCalled();
    });

    it("audits a refused migration attempt, as main's back office did", async () => {
      context.connections.findById.mockResolvedValue(legacyConnection("org_other"));
      const caller = context.callerFor({ id: STAFF_ID });

      await expect(
        caller.startLegacyMigration({
          organizationId: "org_acme",
          legacyConnectionId: "ssoc_1",
          providerId: "okta-direct",
          idp: IDP,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(context.record).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: STAFF_ID,
          action: "ssoConnections.startLegacyMigration",
          organizationId: "org_acme",
        }),
      );
    });
  });
});
