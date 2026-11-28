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

/** A start other than coding or call; the code is what scripts and tests match, not the prose. */
export class UnknownLangyStartError extends Error {
  readonly code = "langy_start_unknown";

  constructor(start: string) {
    super(`Unknown start: ${start}. Use coding or call.`);
    this.name = "UnknownLangyStartError";
  }
}

/**
 * Record the start the person picked on Langy's governance opener: coding or call.
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
export const onboardingStartCommand = async (start: string): Promise<CommandResult | void> => {
  if (!isLangyStart(start)) {
    throw new UnknownLangyStartError(start);
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
