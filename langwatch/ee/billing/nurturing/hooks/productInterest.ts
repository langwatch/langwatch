import { getApp } from "../../../../src/server/app-layer/app";
import { captureException } from "../../../../src/utils/posthogErrorCapture";
import type { CioPersonTraits } from "../types";

/**
 * Valid integration method trait values sent to Customer.io.
 *
 * These are the canonical CIO trait values. The onboarding product-selection
 * screen ("Pick your flavour") uses different UI keys; the mapping below
 * translates from those UI keys to these trait values.
 */
export type IntegrationMethodValue =
  | "coding_agent"
  | "platform"
  | "mcp"
  | "manual_sdk";

/**
 * Maps the UI product selection key to the Customer.io integration_method trait value.
 *
 * The onboarding "Pick your flavour" screen asks HOW the user wants to
 * integrate. We map the integration method UI key to the CIO trait:
 *
 * - "via-claude-code"    -> "coding_agent"
 * - "via-platform"       -> "platform"
 * - "via-claude-desktop" -> "mcp"
 * - "manually"           -> "manual_sdk"
 */
export function mapProductSelectionToIntegrationMethod(
  selection: string
): IntegrationMethodValue {
  const mapping: Record<string, IntegrationMethodValue> = {
    "via-claude-code": "coding_agent",
    "via-platform": "platform",
    "via-claude-desktop": "mcp",
    "manually": "manual_sdk",
  };

  if (!Object.hasOwn(mapping, selection)) {
    throw new Error(`Unknown product selection: ${selection}`);
  }
  return mapping[selection]!;
}

/**
 * Fires a separate identifyUser call to set the integration_method trait.
 *
 * Called from the "Pick your flavour" onboarding screen AFTER the initial
 * signup identification (initializeOrganization fires before flavour selection).
 * Fire-and-forget -- does not block navigation.
 */
export function fireIntegrationMethodNurturing({
  userId,
  integrationMethod,
}: {
  userId: string;
  integrationMethod: IntegrationMethodValue;
}): void {
  const nurturing = getApp().nurturing;
  if (!nurturing) return;

  void nurturing
    .identifyUser({
      userId,
      traits: { integration_method: integrationMethod } as Partial<CioPersonTraits>,
    })
    .catch(captureException);
}
