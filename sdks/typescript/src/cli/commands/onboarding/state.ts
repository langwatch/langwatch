import { OnboardingApiService } from "@/client-sdk/services/onboarding/onboarding-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { guidedStateCard } from "./card";

/**
 * Print the guided onboarding state of the organization this project belongs to.
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
export const onboardingStateCommand = async (): Promise<CommandResult | void> => {
  await resolveCredentials();
  const state = guidedStateCard(await new OnboardingApiService().getGuidedState());
  return {
    data: state,
    table: () => {
      console.log(JSON.stringify(state, null, 2));
    },
  };
};
