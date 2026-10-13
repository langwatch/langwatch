/**
 * What a mounted ops declaration reads off the request: who is asking, and whose platform grant
 * the door asks (the impersonator's, where there is one). The grant is the test's `holders`.
 */
import type { TrpcRuntimeMembers } from "@langwatch/api/trpc";
import type { OpsOperator, OpsOperatorPermission } from "@langwatch/ops-contract";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";

export type OpsTrpcTestContext = { actor: { id: string } | null; operator: OpsOperator | null };

export function opsTrpcMembers({
  holders,
  asked = () => {},
}: {
  holders: Readonly<Record<string, readonly OpsOperatorPermission[]>>;
  /** Told each platform permission the door asks, so a test can pin the grain. */
  asked?: (permission: OpsOperatorPermission) => void;
}): TrpcRuntimeMembers<OpsTrpcTestContext> {
  const members = trpcTestMembers<OpsTrpcTestContext>();

  return {
    ...members,
    identity: {
      caller: ({ operator }) => {
        if (!operator) return { actor: null };
        const impersonatorId = operator.impersonator?.id;

        return {
          actor: { type: "user", id: operator.id, ...(impersonatorId ? { impersonatorId } : {}) },
        };
      },
    },
    authorization: {
      forRequest: (ctx) => ({
        ...members.authorization.forRequest(ctx),
        getPlatformDecision: async ({ userId, permission }) => {
          asked(permission);

          return { permitted: (holders[userId] ?? []).some((held) => held === permission) };
        },
      }),
    },
  };
}
