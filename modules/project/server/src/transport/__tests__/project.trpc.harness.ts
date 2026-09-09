/**
 * The process ports a mounted project declaration runs on, as a test supplies
 * them: one signed-in person, and an authorization answer the test decides.
 */
import type { TrpcRuntimePorts } from "@langwatch/api/trpc";

/** What a mount reads off the request: the caller, and nothing else. */
export type ProjectTrpcTestContext = { actor: { id: string } };

/** Whether the caller holds one permission on the scope the input named. */
export type ProjectTrpcTestDecision = (permission: string) => boolean;

export function projectTrpcTestPorts(
  permits: ProjectTrpcTestDecision = () => true,
): TrpcRuntimePorts<ProjectTrpcTestContext> {
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
