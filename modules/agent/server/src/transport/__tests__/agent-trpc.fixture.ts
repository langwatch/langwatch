/**
 * The declared tRPC path, as these tests need it: a runtime whose ports permit
 * everything, and a factory that records what each procedure declared without
 * building one.
 */
import type { Actor } from "@langwatch/actor";
import type { TrpcProcedureFactory, TrpcRuntimePorts } from "@langwatch/api/trpc";
import { createTrpcRuntime } from "@langwatch/api/trpc";
import type { AuthzDeclaration, AuthzPermission } from "@langwatch/authz-contract";
import { initTRPC } from "@trpc/server";

type TestContext = object;

/** Every check passes: these tests are about the handler, not the decision. */
function permissivePorts(actor: (Actor & { id: string }) | null): TrpcRuntimePorts<TestContext> {
  return {
    identity: { caller: () => ({ actor }) },
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

/** Mounts one declaration over an application and answers a caller for it. */
export function agentTrpcCaller<Api, Caller>(options: {
  declaration: {
    router(
      runtime: TrpcProcedureFactory<TestContext>,
      app: (ctx: TestContext) => Api,
    ): {
      createCaller(ctx: TestContext): Caller;
    };
  };
  app: Api;
  actor?: (Actor & { id: string }) | null;
}) {
  const root = initTRPC.context<TestContext>().create();
  const runtime = createTrpcRuntime<TestContext>({
    root,
    procedure: root.procedure,
    ports: permissivePorts(
      options.actor === undefined ? { type: "user", id: "user_1" } : options.actor,
    ),
  });

  return options.declaration.router(runtime, () => options.app).createCaller({});
}

/** Records the access each declared procedure asked for, building nothing. */
export function accessDeclaredBy(declaration: {
  router(runtime: TrpcProcedureFactory<TestContext>, app: (ctx: TestContext) => never): unknown;
}): (AuthzPermission | AuthzDeclaration)[] {
  const declared: (AuthzPermission | AuthzDeclaration)[] = [];
  const runtime: TrpcProcedureFactory<TestContext> = {
    procedure: ({ access }) => {
      declared.push(access.kind === "permission" ? access.permission : access);

      return {};
    },
    router: (record) => record,
  };

  declaration.router(runtime, () => {
    throw new Error("This test mounts but never handles a request");
  });

  return declared;
}
