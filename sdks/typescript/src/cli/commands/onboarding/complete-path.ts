import { OnboardingApiService } from "@/client-sdk/services/onboarding/onboarding-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { guidedPathDoneCard } from "./card";

/**
 * Mark one guided onboarding path as done for the organization this project
 * belongs to. Langy runs it at the end of a guided setup so the Home offer
 * stops proposing that path and the campaigns see it finish. Idempotent: a
 * second run changes nothing. A path outside llmops, coding, gateway and
 * governance is refused by the platform, and nothing is printed for it.
 *
 * What it prints is the panel's done marker: one line naming the path.
 *
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
