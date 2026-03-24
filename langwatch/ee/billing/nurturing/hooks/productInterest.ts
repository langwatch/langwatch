import { getApp } from "../../../../src/server/app-layer/app";
import { captureException } from "../../../../src/utils/posthogErrorCapture";
import type { CioPersonTraits } from "../types";

/**
 * Valid product interest trait values sent to Customer.io (R10 spec).
 *
 * These are the canonical CIO trait values. The onboarding integration-method
 * screen ("Pick your flavour") uses different UI keys; the mapping below
 * translates from those UI keys to these trait values.
 */
export type ProductInterestValue =
  | "observability"
  | "evaluations"
  | "prompt_management"
  | "agent_simulations";

/**
 * Maps the UI product selection key to the Customer.io trait value.
 *
 * The onboarding "Pick your flavour" screen asks HOW the user wants to
 * integrate, not WHAT product they're interested in. We map the integration
 * method to a best-guess product interest:
 *
 * - "via-claude-code"    -> "observability"       (coding agent users want traces/analytics)
 * - "via-platform"       -> "evaluations"         (platform UI users want evaluations)
 * - "via-claude-desktop" -> "prompt_management"   (MCP users want prompt management)
 * - "manually"           -> "agent_simulations"   (manual SDK users often test agents)
 */
export function mapProductSelectionToTrait(
  selection: string
): ProductInterestValue {
  const mapping: Record<string, ProductInterestValue> = {
    "via-claude-code": "observability",
    "via-platform": "evaluations",
    "via-claude-desktop": "prompt_management",
    "manually": "agent_simulations",
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
