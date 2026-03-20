import { getApp } from "../../../../src/server/app-layer/app";
import { captureException } from "../../../../src/utils/posthogErrorCapture";
import type { CioPersonTraits } from "../types";

/**
 * Valid product interest trait values sent to Customer.io.
 *
 * Maps from the onboarding "Pick your flavour" selection to CIO trait values.
 */
export type ProductInterestValue =
  | "observability"
  | "evaluations"
  | "prompt_management"
  | "agent_simulations";

/**
 * Maps the UI product selection key to the Customer.io trait value.
 *
 * The UI uses hyphenated keys ("prompt-management", "agent-simulations")
 * while CIO traits use underscores.
 */
export function mapProductSelectionToTrait(
  selection: string
): ProductInterestValue {
  const mapping: Record<string, ProductInterestValue> = {
    observability: "observability",
    evaluations: "evaluations",
    "prompt-management": "prompt_management",
    "agent-simulations": "agent_simulations",
  };

  const mapped = mapping[selection];
  if (!mapped) {
    throw new Error(`Unknown product selection: ${selection}`);
  }
  return mapped;
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
