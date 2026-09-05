import { OnboardingApiService } from "@/client-sdk/services/onboarding/onboarding-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";

/**
 * Mark one guided onboarding path as done for the organization this project
 * belongs to. Langy runs it at the end of a guided setup so the Home offer
 * stops proposing that path and the campaigns see it finish. Idempotent: a
 * second run changes nothing. A path outside llmops, coding, gateway and
 * governance is refused by the platform.
 *
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
export const onboardingCompletePathCommand = async (
  path: string,
): Promise<CommandResult | void> => {
  await resolveCredentials();
  const state = await new OnboardingApiService().completePath(path);
  return {
    data: state,
    table: () => {
      console.log(JSON.stringify(state, null, 2));
    },
  };
};
