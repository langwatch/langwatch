import { OnboardingApiService } from "@/client-sdk/services/onboarding/onboarding-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { guidedPathDoneCard } from "./card";

/**
 * Mark one guided onboarding path as done for the organization. Idempotent.
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
export const onboardingCompletePathCommand = async (
  path: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();
  await new OnboardingApiService().completePath(path);
  const card = guidedPathDoneCard(path);
  return {
    data: card,
    table: () => {
      console.log(card.text);
    },
  };
};
