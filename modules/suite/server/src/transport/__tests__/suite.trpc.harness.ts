/**
 * The process ports a mounted suite declaration runs on, as a test supplies
 * them: one signed-in person, and an authorization answer the test decides.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { TrpcRuntimePorts } from "@langwatch/api/trpc";

export type SuiteTrpcTestContext = { actor: { id: string } };

/** Whether the caller holds one permission on the scope the input named. */
export type SuiteTrpcTestDecision = (permission: AuthzPermission) => boolean;

export function suiteTrpcTestPorts(
  permits: SuiteTrpcTestDecision = () => true,
): TrpcRuntimePorts<SuiteTrpcTestContext> {
  return {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
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
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };
}
