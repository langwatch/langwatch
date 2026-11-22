import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";

/**
 * Valid integration method trait values sent to Customer.io.
 */
export type IntegrationMethodValue = "coding_agent" | "platform" | "mcp" | "manual_sdk";

/**
 * Maps the UI product selection key to the Customer.io integration_method trait value.
 */
export function integrationMethodFor(selection: string): IntegrationMethodValue {
  const mapping: Record<string, IntegrationMethodValue> = {
    "via-claude-code": "coding_agent",
    "via-platform": "platform",
    "via-claude-desktop": "mcp",
    manually: "manual_sdk",
  };

  if (!Object.hasOwn(mapping, selection)) {
    throw new Error(`Unknown product selection: ${selection}`);
  }

  return mapping[selection]!;
}

/**
 * Decides the identify call that sets the integration_method trait.
 */
export function fireIntegrationMethod({
  userId,
  integrationMethod,
}: {
  userId: string;
  integrationMethod: IntegrationMethodValue;
}): CioBatchCall[] {
  return [
    {
      type: "identify",
      userId,
      traits: { integration_method: integrationMethod },
    },
  ];
}

/**
 * A member of an organization that sends coding-agent sessions. A trait of its own, so the
 * integration_method a member chose in onboarding is never overwritten.
 */
export function fireUsesCodingAgent({ userId }: { userId: string }): CioBatchCall[] {
  return [{ type: "identify", userId, traits: { uses_coding_agent: true } }];
}
