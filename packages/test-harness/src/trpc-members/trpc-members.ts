import type { TrpcRuntimeMembers } from "@langwatch/api/trpc";

type Decisions<TContext> = ReturnType<TrpcRuntimeMembers<TContext>["authorization"]["forRequest"]>;
type Permission<TContext> = Parameters<Decisions<TContext>["getDecision"]>[0]["permission"];

/** Whether the caller holds one permission on the scope the input named. */
export type TrpcTestDecision<TContext> = (permission: Permission<TContext>) => boolean;

/**
 * The process members a mounted tRPC declaration runs on, as a test supplies them:
 * the signed-in person on the context (or nobody), and an authorization answer the
 * test decides. Audit and error reporting are silent; pass overrides to observe them.
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
