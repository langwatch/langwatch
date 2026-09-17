import { findSink, reportFailure } from "./nurturing-sink-registry-service.rules.ts";
import type { CioPersonTraits } from "@langwatch/enterprise-billing-contract";

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
 * Fires a separate identifyUser call to set the integration_method trait.
 */
export function fireIntegrationMethod({
  userId,
  integrationMethod,
}: {
  userId: string;
  integrationMethod: IntegrationMethodValue;
}): void {
  const nurturing = findSink();
  if (!nurturing) {
    return;
  }

  void nurturing
    .identifyUser({
      userId,
      traits: {
        integration_method: integrationMethod,
      } as Partial<CioPersonTraits>,
    })
    .catch(reportFailure);
}
