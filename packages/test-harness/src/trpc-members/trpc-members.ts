import type { TrpcRuntimeMembers } from "@langwatch/api/trpc";

import { mintTestAuthorization } from "./test-authorization.ts";

type Decisions<TContext> = ReturnType<TrpcRuntimeMembers<TContext>["authorization"]["forRequest"]>;
type Permission<TContext> = Parameters<Decisions<TContext>["getDecision"]>[0]["permission"];

/** Whether the caller holds one permission on the scope the input named. */
export type TrpcTestDecision<TContext> = (permission: Permission<TContext>) => boolean;

/**
 * A mounted tRPC declaration's members as a test supplies them: the context's person, an
 * authorization answer the test decides, an own-grant proof per proof-bearing read; audit
 * and error reporting silent (pass overrides to observe them).
 */
export function trpcTestMembers<TContext extends { actor: { id: string } | null }>({
  permits = () => true,
  overrides = {},
}: {
  permits?: TrpcTestDecision<TContext>;
  overrides?: Partial<TrpcRuntimeMembers<TContext>>;
} = {}): TrpcRuntimeMembers<TContext> {
  return {
    identity: {
      caller: (ctx) =>
        ctx.actor ? { actor: { type: "user", id: ctx.actor.id } } : { actor: null },
    },
    authorization: {
      forRequest: () => ({
        getDecision: async ({ permission }) => ({
          permitted: permits(permission),
          organizationRole: null,
        }),
        getProjectAnyDecision: async ({ permissions }) => ({
          permitted: permissions.some((permission) => permits(permission)),
          organizationRole: null,
        }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
        authorization: mintTestAuthorization,
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: {
      record: async () => {},
      redact: ({ args }) => args,
      exempt: () => false,
      organizationOf: async () => null,
    },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
    ...overrides,
  };
}
