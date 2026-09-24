import {
  createTrpcRuntime,
  type TrpcProcedureFactory,
  type TrpcRuntimeMembers,
} from "@langwatch/api/trpc";
import type { AuthzDeclaration, AuthzPermission } from "@langwatch/authz-contract";
import { initTRPC } from "@trpc/server";

export type TestContext = { actor: { id: string } };

export function createTestTrpcRuntime() {
  const trpc = initTRPC.context<TestContext>().create();
  const members: TrpcRuntimeMembers<TestContext> = {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
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

  return createTrpcRuntime<TestContext>({ root: trpc, procedure: trpc.procedure, members });
}

/** The access each declared procedure asked for, keyed `namespace.procedure`, building nothing. */
export function accessDeclaredBy(declaration: {
  router(runtime: TrpcProcedureFactory<object>, app: (ctx: object) => never): unknown;
}): Record<string, AuthzPermission | AuthzDeclaration> {
  const declared: Record<string, AuthzPermission | AuthzDeclaration> = {};
  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ access, procedure }) => {
      declared[procedure] = access.kind === "permission" ? access.permission : access;

      return {};
    },
    router: (record) => record,
  };

  declaration.router(runtime, () => {
    throw new Error("This helper mounts but never handles a request");
  });

  return declared;
}
