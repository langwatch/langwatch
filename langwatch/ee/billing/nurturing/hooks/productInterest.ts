import { getApp } from "../../../../src/server/app-layer/app";
import { captureException } from "../../../../src/utils/posthogErrorCapture";
import type { CioPersonTraits } from "../types";

/**
 * Valid product interest trait values sent to Customer.io.
 *
 * Maps from the onboarding integration-method selection to CIO trait values.
 * The onboarding asks "how do you want to integrate?" rather than "what product?"
 */
export type ProductInterestValue =
  | "coding_agent"
  | "platform"
  | "mcp"
  | "manual_sdk";

/**
 * Maps the UI product selection key to the Customer.io trait value.
 *
 * The UI uses hyphenated keys ("via-claude-code", "via-platform", etc.)
 * while CIO traits use underscore-separated descriptive values.
 */
export function mapProductSelectionToTrait(
  selection: string
): ProductInterestValue {
  const mapping: Record<string, ProductInterestValue> = {
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
 * Fires a separate identifyUser call to set the product_interest trait.
 *
 * Called from the "Pick your flavour" onboarding screen AFTER the initial
 * signup identification (initializeOrganization fires before flavour selection).
 * Fire-and-forget — does not block navigation.
 */
export function fireProductInterestNurturing({
  userId,
  productInterest,
}: {
  userId: string;
  productInterest: ProductInterestValue;
}): void {
  const nurturing = getApp().nurturing;
  if (!nurturing) return;

  void nurturing
    .identifyUser({
      userId,
      traits: { product_interest: productInterest } as Partial<CioPersonTraits>,
    })
    .catch(captureException);
}
