/**
 * The guided state with what only the instance knows: the gateway URL an app
 * on it points at. It is the instance's, not the organization's, so it rides
 * on every answer instead of being stored.
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { ensureGatewayV1BaseUrl } from "@langwatch/langy-contract";

export type GuidedOnboardingGatewayConfig = Readonly<{
  publicUrl?: string;
  baseUrl?: string;
}>;

export function withInstanceFacts<S extends object>(
  state: S,
  gateway: GuidedOnboardingGatewayConfig,
): S & Readonly<{ gatewayUrl?: string }> {
  const base = gateway.publicUrl ?? gateway.baseUrl;
  return base ? { ...state, gatewayUrl: ensureGatewayV1BaseUrl(base) } : state;
}
