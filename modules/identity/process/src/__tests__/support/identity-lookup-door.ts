import {
  bindTrpcMiddlewareContext,
  createTrpcRuntime,
  TrpcRootDefinition,
  type TrpcRuntimeMembers,
} from "@langwatch/api/trpc";
import type { IdentityLookupApi } from "@langwatch/identity-contract";
import type { OpsOperator } from "@langwatch/ops-contract";
import { testAuthorizeDefaults } from "@langwatch/test-harness/trpc-members";

import {
  identityLookupTrpcTransport,
  operatorContext,
} from "../../transport/identity-lookup.trpc.ts";

type Context = { actor: { type: "user"; id: string } | null; operator: OpsOperator | null };

const root = TrpcRootDefinition.forContext<Context>().create({});

/** The real tRPC door in front of the lookup: `operators` hold ops:manage at the platform. */
export function identityLookupDoor({
  app,
  operators,
}: {
  app: IdentityLookupApi;
  operators: readonly string[];
}) {
  const members: TrpcRuntimeMembers<Context> = {
    identity: { caller: (ctx) => ({ actor: ctx.actor }) },
    authorization: {
      forRequest: () => ({
        ...testAuthorizeDefaults,
        getDecision: async () => ({ permitted: false, organizationRole: null }),
        getProjectAnyDecision: async () => ({ permitted: false, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
        getPlatformDecision: async ({ userId, permission }) => ({
          permitted: permission === "ops:manage" && operators.includes(userId),
        }),
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
  const runtime = createTrpcRuntime<Context>({ root, procedure: root.procedure, members });
  const router = runtime.mount(identityLookupTrpcTransport, () => app, {
    middlewareContext: [bindTrpcMiddlewareContext(operatorContext, (ctx: Context) => ctx.operator)],
  });

  return {
    as: (userId: string | null) =>
      router.createCaller({
        actor: userId ? { type: "user", id: userId } : null,
        operator: userId ? { id: userId, email: `${userId}@langwatch.test` } : null,
      }),
  };
}

/** The tRPC code and the HandledError code a refusal reached the caller with. */
export function refusalOf(failure: unknown): { trpc: string; code: string; message: string } {
  const error = failure as { code: string; message: string; cause?: { code?: string } };

  return { trpc: error.code, code: error.cause?.code ?? "", message: error.message };
}
