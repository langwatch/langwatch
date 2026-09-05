/**
 * The guided onboarding as the client sees it: is this organization in the
 * guided variant, and what does its guided state say. One hook for the tour
 * host and the Home offer, so both read the same query and the same flag.
 *
 * @see specs/features/onboarding/guided-tour.feature
 * @see specs/home/guided-onboarding-offer.feature
 */
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { GuidedOnboardingState } from "~/server/schemas/sign-up-data.schema";
import { api } from "~/utils/api";

export const GUIDED_ONBOARDING_FLAG = "experiment_onboarding_langy_guided";

export interface GuidedOnboardingView {
  /** The organization is in the guided variant and its state has loaded. */
  guided: boolean;
  state: GuidedOnboardingState | null;
  organizationId: string | null;
  isLoading: boolean;
}

export function useGuidedOnboarding(): GuidedOnboardingView {
  const { organization, project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const organizationId = organization?.id ?? null;
  const flag = useFeatureFlag(GUIDED_ONBOARDING_FLAG, {
    projectId: project?.id,
    organizationId: organizationId ?? undefined,
    enabled: !!organizationId,
  });
  const stateQuery = api.onboarding.getGuidedState.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: !!organizationId && flag.enabled },
  );
  return {
    guided: flag.enabled && !!stateQuery.data,
    state: stateQuery.data ?? null,
    organizationId,
    isLoading: flag.isLoading || (flag.enabled && stateQuery.isLoading),
  };
}
