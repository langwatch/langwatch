/**
 * The process members a mounted `github.*` declaration runs on, as a test
 * supplies them: one signed-in person, an authorization answer the test
 * decides, and a record of every permission the runtime asked for.
 */
import type { TrpcRuntimeMembers } from "@langwatch/api/trpc";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";

/** What a mount reads off the request: the caller, and nothing else. */
export type GithubTrpcTestContext = { actor: { id: string } };

/** Whether the caller holds one permission on the scope the input named. */
export type GithubTrpcTestDecision = (permission: string) => boolean;

/** The members, beside the list the runtime writes every asked permission into. */
export function githubTrpcTestMembers(permits: GithubTrpcTestDecision = () => true): {
  members: TrpcRuntimeMembers<GithubTrpcTestContext>;
  asked: string[];
} {
  const asked: string[] = [];

  return {
    asked,
    members: trpcTestMembers<GithubTrpcTestContext>({
      permits: (permission) => {
        asked.push(permission);

        return permits(permission);
      },
    }),
  };
}
