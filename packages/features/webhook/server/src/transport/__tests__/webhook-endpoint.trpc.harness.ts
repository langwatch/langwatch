/**
 * The process ports a mounted `webhookEndpoints` declaration runs on, as a test
 * supplies them: one signed-in person, and an authorization answer the test
 * decides. Every permission asked is recorded, in the order it was asked.
 */
import type { TrpcRuntimePorts } from "@langwatch/api/trpc";

/** What a mount reads off the request: the caller, and nothing else. */
export type WebhookEndpointTrpcTestContext = { actor: { id: string } };

/** The recorded checks, and the ports that recorded them. */
export type WebhookEndpointTrpcTestPorts = {
  seenPermissions: string[];
  ports: TrpcRuntimePorts<WebhookEndpointTrpcTestContext>;
};

export function webhookEndpointTrpcTestPorts(
  denied: ReadonlySet<string> = new Set(),
): WebhookEndpointTrpcTestPorts {
  const seenPermissions: string[] = [];

  return {
    seenPermissions,
    ports: {
      identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
      authorization: {
        forRequest: () => ({
          getDecision: async ({ permission }) => {
            seenPermissions.push(permission);

            return { permitted: !denied.has(permission), organizationRole: null };
          },
          getProjectAnyDecision: async ({ permissions }) => ({
            permitted: permissions.some((permission) => !denied.has(permission)),
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
