/**
 * The process members a mounted `webhookEndpoints` declaration runs on, as a test
 * supplies them: one signed-in person, and an authorization answer the test
 * decides. Every permission asked is recorded, in the order it was asked.
 */
import type { TrpcRuntimeMembers } from "@langwatch/api/trpc";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";

/** What a mount reads off the request: the caller, and nothing else. */
export type WebhookEndpointTrpcTestContext = { actor: { id: string } };

/** The recorded checks, and the members that recorded them. */
export type WebhookEndpointTrpcTestMembers = {
  seenPermissions: string[];
  members: TrpcRuntimeMembers<WebhookEndpointTrpcTestContext>;
};

export function webhookEndpointTrpcTestMembers(
  denied: ReadonlySet<string> = new Set(),
): WebhookEndpointTrpcTestMembers {
  const seenPermissions: string[] = [];

  return {
    seenPermissions,
    members: trpcTestMembers<WebhookEndpointTrpcTestContext>({
      permits: (permission) => {
        seenPermissions.push(permission);

        return !denied.has(permission);
      },
    }),
  };
}
