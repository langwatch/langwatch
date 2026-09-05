/**
 * The guided onboarding as the client sees it: is this organization in the
 * guided variant, and what does its guided state say. The tour host reads
 * the full state; the Home offer only needs the flag, its state comes with
 * the onboarding checks the home already loads.
 *
 * @see specs/features/onboarding/guided-tour.feature
 * @see specs/home/guided-onboarding-offer.feature
 */
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { GuidedOnboardingState } from "~/server/schemas/sign-up-data.schema";
import { api } from "~/utils/api";

export const GUIDED_ONBOARDING_FLAG = "experiment_onboarding_langy_guided";

export interface GuidedOnboardingFlagView {
  /** The guided variant is on for this organization. */
  enabled: boolean;
  organizationId: string | null;
  isLoading: boolean;
}

export function useGuidedOnboardingFlag(): GuidedOnboardingFlagView {
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
  return { enabled: flag.enabled, organizationId, isLoading: flag.isLoading };
}

export interface GuidedOnboardingView {
  /** The organization is in the guided variant and its state has loaded. */
  guided: boolean;
  state: GuidedOnboardingState | null;
  organizationId: string | null;
  isLoading: boolean;
}

export function useGuidedOnboarding(
  options: { enabled?: boolean } = {},
): GuidedOnboardingView {
  const flag = useGuidedOnboardingFlag();
  const { organizationId } = flag;
  const enabled = options.enabled ?? true;
  const stateQuery = api.onboarding.getGuidedState.useQuery(
    { organizationId: organizationId ?? "" },
    { enabled: enabled && !!organizationId && flag.enabled },
  );
  return {
    guided: flag.enabled && !!stateQuery.data,
    state: stateQuery.data ?? null,
    organizationId,
    isLoading: flag.isLoading || (flag.enabled && stateQuery.isLoading),
  };
}
