import { createTrpcRuntime, type TrpcAccess, type TrpcProcedureFactory } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authorization";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { initTRPC } from "@trpc/server";

export type TestContext = { actor: { id: string } };

export function createTestTrpcRuntime() {
  const trpc = initTRPC.context<TestContext>().create();
  const members = trpcTestMembers<TestContext>();

  return createTrpcRuntime<TestContext>({ root: trpc, procedure: trpc.procedure, members });
}

/** The access each declared procedure asked for, keyed `namespace.procedure`, building nothing. */
export function accessDeclaredBy(declaration: {
  router(runtime: TrpcProcedureFactory<object>, app: (ctx: object) => never): unknown;
}): Record<string, AuthzPermission | TrpcAccess> {
  const declared: Record<string, AuthzPermission | TrpcAccess> = {};
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
