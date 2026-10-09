/** Onboarding UI and hooks lent by token to the spaces, pages and shell that read them. */

import { uiTokens } from "@langwatch/module";
import type { GuidedOnboardingOfferProps, GuidedTourHooks } from "@langwatch/onboarding-contract";

/** Whether a guided tour is on screen, and a replay of one; both are hooks, read in render. */
export type GuidedTourState = {
  useRunning(): boolean;
  /** The replay: runs `path`'s tour again and records it on the organization, when named. */
  useReplay(): (input: { path: string; organizationId?: string | null }) => void;
};

/** Onboarding's guided path; `useIsActive` is a hook, call it during render. */
export type GuidedPathActive = { useIsActive(): boolean };

/** First-touch attribution: `useCapture` is a hook the shell calls at its outermost provider. */
export type FirstTouchAttribution = {
  readonly useCapture: () => void;
  /** UTM and `ref` params of the current URL when it has any, else the stored first touch. */
  eventProperties(): Readonly<Record<string, string>>;
};

const onboarding = uiTokens("onboarding");

export const GuidedOnboardingOfferToken =
  onboarding.component<GuidedOnboardingOfferProps>("guidedOnboardingOffer");
export const GuidedTourToken = onboarding.hooks<GuidedTourHooks>("guidedTourActions");
export const GuidedTourStateToken = onboarding.hooks<GuidedTourState>("guidedTour");
export const GuidedPathActiveToken = onboarding.hooks<GuidedPathActive>("guidedPathActive");
export const FirstTouchAttributionToken =
  onboarding.hooks<FirstTouchAttribution>("firstTouchAttribution");
