/** What onboarding lends this module by token (ARCHITECTURE.md §10.1). */

import { Lent } from "@langwatch/browser-host/lent";
import { GuidedOnboardingOfferToken } from "@langwatch/onboarding-client";

/** What this module hands the offer: its own space, restated structurally (round 6). */
type GuidedOnboardingOfferProps = { space: "me"; spaceInUse?: boolean | null };

/** Onboarding's "Start guided onboarding" pill, drawn as onboarding lends it. */
export function GuidedOnboardingOffer(props: GuidedOnboardingOfferProps) {
  return <Lent of={GuidedOnboardingOfferToken} props={props} />;
}
