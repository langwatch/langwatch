/**
 * The process ports a mounted `github.*` declaration runs on, as a test
 * supplies them: one signed-in person, an authorization answer the test
 * decides, and a record of every permission the runtime asked for.
 */
import type { TrpcRuntimePorts } from "@langwatch/api/trpc";

/** What a mount reads off the request: the caller, and nothing else. */
export type GithubTrpcTestContext = { actor: { id: string } };

/** Whether the caller holds one permission on the scope the input named. */
export type GithubTrpcTestDecision = (permission: string) => boolean;

/** The ports, beside the list the runtime writes every asked permission into. */
export function githubTrpcTestPorts(permits: GithubTrpcTestDecision = () => true): {
  ports: TrpcRuntimePorts<GithubTrpcTestContext>;
  asked: string[];
} {
  const asked: string[] = [];

  return {
    asked,
    ports: {
      identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
      authorization: {
        forRequest: () => ({
          getDecision: async ({ permission }) => {
            asked.push(permission);

            return { permitted: permits(permission), organizationRole: null };
          },
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
    },
  };
}
