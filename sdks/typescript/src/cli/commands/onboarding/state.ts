import { OnboardingApiService } from "@/client-sdk/services/onboarding/onboarding-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";

/**
 * Print the guided onboarding state of the organization this project belongs
 * to: the paths picked in order, the one being set up, the ones done, the
 * provider connected and where the tour stands. Langy reads it to know which
 * path it is guiding and what is left.
 *
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
export const onboardingStateCommand = async (): Promise<CommandResult | void> => {
  await resolveCredentials();
  const state = await new OnboardingApiService().getGuidedState();
  return {
    data: state,
    table: () => {
      console.log(JSON.stringify(state, null, 2));
    },
  };
};
