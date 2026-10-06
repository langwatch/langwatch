/** What onboarding lends this module by token (ARCHITECTURE.md §10.1). */

import { Lent } from "@langwatch/browser-host/lent";
import {
  GuidedOnboardingOfferToken,
  type GuidedOnboardingOfferProps,
} from "@langwatch/onboarding-contract";

/** Onboarding's "Start guided onboarding" pill, drawn as onboarding lends it. */
export function GuidedOnboardingOffer(props: GuidedOnboardingOfferProps) {
  return <Lent of={GuidedOnboardingOfferToken} props={props} />;
}
