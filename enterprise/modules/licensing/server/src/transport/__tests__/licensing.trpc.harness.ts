/**
 * The process ports a mounted licensing declaration runs on, as a test supplies
 * them: one signed-in person, the address the process resolved for them, and an
 * authorization answer the test decides.
 */
import type { TrpcRuntimePorts } from "@langwatch/api/trpc";

/** What a mount reads off the request: the caller, and their address. */
export type LicensingTrpcTestContext = {
  actor: { id: string };
  email?: string | null;
};

/** Whether the caller holds one permission on the scope the input named. */
export type LicensingTrpcTestDecision = (permission: string) => boolean;

export function licensingTrpcTestPorts(
  permits: LicensingTrpcTestDecision = () => true,
): TrpcRuntimePorts<LicensingTrpcTestContext> {
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
