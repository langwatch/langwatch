/** Onboarding guided-start pill, lent by token to the spaces that offer it (§10.1). */

import { uiTokens } from "@langwatch/module";

/** The product space a guided onboarding offer sits in. */
export type GuidedSpace = "project" | "me" | "gateway" | "governance";

/**
 * What a screen hands onboarding's guided offer: the space it sits in, and its own answer to
 * whether that space is already in use (null while unknown, which keeps the offer hidden).
 */
export type GuidedOnboardingOfferProps = {
  space: GuidedSpace;
  spaceInUse?: boolean | null;
};

export const GuidedOnboardingOfferToken =
  uiTokens("onboarding").component<GuidedOnboardingOfferProps>("guidedOnboardingOffer");
