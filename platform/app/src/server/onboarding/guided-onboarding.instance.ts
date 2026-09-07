/**
 * The guided state with what only the instance knows: the gateway URL an app
 * on it points at. It is the instance's, not the organization's, so it rides
 * on every answer instead of being stored. The kickoff brief names it and the
 * skill prints it in the snippet, never a hardcoded host.
 *
 * @see specs/langy/langy-guided-onboarding.feature
 */
import { env } from "~/env.mjs";
import { ensureGatewayV1BaseUrl } from "~/server/app-layer/langy/LangyCredentialService";
import type { GuidedOnboardingState } from "~/server/schemas/sign-up-data.schema";

/** The guided state with what the kickoff brief needs from the instance. */
export type GuidedOnboardingStateView = GuidedOnboardingState & {
  /** The gateway URL an app on this instance points at, with its /v1. */
  gatewayUrl?: string;
};

export function withInstanceFacts(
  state: GuidedOnboardingState,
): GuidedOnboardingStateView {
  const base = env.LW_GATEWAY_PUBLIC_URL ?? env.LW_GATEWAY_BASE_URL;
  return base ? { ...state, gatewayUrl: ensureGatewayV1BaseUrl(base) } : state;
}
