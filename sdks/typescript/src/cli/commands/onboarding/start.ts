import {
  OnboardingApiService,
  type LangyStart,
} from "@/client-sdk/services/onboarding/onboarding-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { langyStartCard } from "./card";

const LANGY_STARTS: readonly string[] = ["coding", "call"] satisfies LangyStart[];

function isLangyStart(start: string): start is LangyStart {
  return LANGY_STARTS.includes(start);
}

/**
 * Record the start the person picked on Langy's governance opener: coding or call.
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
export const onboardingStartCommand = async (start: string): Promise<CommandResult | void> => {
  if (!isLangyStart(start)) {
    throw new Error(`Unknown start: ${start}. Use coding or call.`);
  }
  await resolveCredentials();
  await new OnboardingApiService().recordLangyStart(start);
  const card = langyStartCard(start);
  return {
    data: card,
    table: () => {
      console.log(card.text);
    },
  };
};
