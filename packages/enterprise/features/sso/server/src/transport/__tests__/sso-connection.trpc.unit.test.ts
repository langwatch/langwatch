/**
 * @vitest-environment node
 * Who reaches the back office's single sign-on surface, what it refuses by name,
 * and that nothing on it writes a field (specs/identity/sso-onboarding-tiers).
 */
import { createTrpcRuntime, type TrpcRuntimePorts } from "@langwatch/api/trpc";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { AdminSurfaceHiddenError } from "@langwatch/ops-contract";
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSsoTestApp,
  createSsoTestUsers,
  RecordingSsoConnectionLedger,
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

function runtimePorts(): TrpcRuntimePorts<TestContext> {
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

function harness() {
  const connections = RecordingSsoConnectionLedger.create();
  const record = vi.fn<AuditLogApi["record"]>(async () => {});
  const app = createSsoTestApp({
    infrastructure: { connections },
    dependencies: {
      users: createSsoTestUsers({
        [STAFF_ID]: SSO_TEST_STAFF_EMAIL,
        [CUSTOMER_ID]: "ana@acme.com",
      }),
      auditLog: { record, listEntityHistory: async () => [] },
    },
  });

  const trpc = initTRPC.context<TestContext>().create();
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    ports: runtimePorts(),
  }).mount(ssoConnectionTrpcTransport, () => app);

  const callerFor = (actor: TestContext["actor"]) => router.createCaller({ actor });

  return { connections, record, router, callerFor };
}

const TARGET = { organizationId: "org_acme", connectionId: "ssoc_1" };

describe("the back-office single sign-on surface", () => {
  let context: ReturnType<typeof harness>;

  beforeEach(() => {
    context = harness();
  });

  describe("given somebody outside the staff list", () => {
    it("answers a denial that says nothing about the surface", async () => {
      const caller = context.callerFor({ id: CUSTOMER_ID });

      // The hidden-surface error, not a FORBIDDEN: the surface does not confirm
      // its own existence to whoever is probing it.
      const denial = await caller.attestDomain({ ...TARGET, domain: "acme.com" }).then(
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
        () => caller.claimDomain({ ...TARGET, domain: "acme.com" }),
        () => caller.approveDomainClaim({ ...TARGET, domain: "acme.com" }),
        () => caller.attestDomain({ ...TARGET, domain: "acme.com" }),
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
    });
  });

  describe("given a LangWatch operator", () => {
    /** @scenario "An operator cannot change a connection except by commanding it" */
    it("turns every change into a guarded command carrying the operator", async () => {
      const caller = context.callerFor({ id: STAFF_ID });

      await caller.claimDomain({ ...TARGET, domain: "acme.com" });
      await caller.approveDomainClaim({ ...TARGET, domain: "acme.com" });
      await caller.attestDomain({ ...TARGET, domain: "acme.com" });
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
      expect(Object.keys(context.router._def.procedures).sort()).toEqual([
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
      const caller = context.callerFor({ id: CUSTOMER_ID, impersonatorId: STAFF_ID });

      await caller.attestDomain({ ...TARGET, domain: "acme.com" });

      expect(context.connections.attestDomain.mock.calls[0]![0]).toMatchObject({
        operator: { userId: STAFF_ID },
      });
    });

    it("records every attempt in the audit log before the command runs", async () => {
      const caller = context.callerFor({ id: STAFF_ID });
      await caller.attestDomain({ ...TARGET, domain: "acme.com" });

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
      const [[audited]] = context.record.mock.calls as unknown as [
        [{ args: Record<string, unknown> }],
      ];
      expect(audited.args.note).toBeUndefined();
      expect(context.connections.rejectDomainClaim).toHaveBeenCalledWith(
        expect.objectContaining({
          note: "the requester could not be reached at that domain",
        }),
      );
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

    it("carries the seven-day reversal window on a teardown request", async () => {
      const caller = context.callerFor({ id: STAFF_ID });
      await caller.requestTeardown({ ...TARGET, reason: null });

      expect(context.connections.requestTeardown).toHaveBeenCalledWith(
        expect.objectContaining({ graceMs: 7 * 24 * 60 * 60 * 1000 }),
      );
    });
  });
});
