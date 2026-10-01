/**
 * The guided onboarding as the client sees it: is this organization in the
 * guided variant, and what its state says. @see specs/features/onboarding/guided-tour.feature
 */
import type {
  GuidedOnboardingStateWithVariant,
  OnboardingVariant,
} from "@langwatch/onboarding-contract";

import { onboardingApi } from "../../../behavior/onboarding-api.ts";
import { useOnboardingHost } from "../../../model/onboarding-host.ts";

export const GUIDED_ONBOARDING_FLAG = "experiment_onboarding_langy_guided";

export interface GuidedOnboardingFlagView {
  /** The guided variant is on for this organization. */
  enabled: boolean;
  organizationId: string | null;
  isLoading: boolean;
}

export function useGuidedOnboardingFlag(): GuidedOnboardingFlagView {
  const host = useOnboardingHost();
  const organizationId = host.scope().organization?.id ?? null;
  const flag = host.featureFlag(GUIDED_ONBOARDING_FLAG);
  return { enabled: flag.enabled, organizationId, isLoading: flag.isLoading };
}

export interface GuidedOnboardingView {
  /** The organization is in the guided variant and its state has loaded. */
  guided: boolean;
  state: GuidedOnboardingStateWithVariant | null;
  /** The variant assigned at sign-up, null for an organization that predates it. */
  variant: OnboardingVariant | null;
  organizationId: string | null;
  isLoading: boolean;
}

export function useGuidedOnboarding(options: { enabled?: boolean } = {}): GuidedOnboardingView {
  const flag = useGuidedOnboardingFlag();
  const { organizationId } = flag;
  const enabled = options.enabled ?? true;
  const stateQuery = onboardingApi.onboarding.getGuidedState.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: enabled && !!organizationId && flag.enabled },
  );
  return {
    guided: flag.enabled && !!stateQuery.data,
    state: stateQuery.data ?? null,
    variant: stateQuery.data?.variant ?? null,
    organizationId,
    isLoading: flag.isLoading || (flag.enabled && stateQuery.isLoading),
  };
}
