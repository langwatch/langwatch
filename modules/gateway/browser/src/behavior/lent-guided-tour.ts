/** What onboarding lends this module by token (ARCHITECTURE.md §3.4, rule 7). */

import { useLentHooks } from "@langwatch/browser-host/lent";
import { GuidedTourToken, type GuidedTourHooks } from "@langwatch/onboarding-contract";

/** What a composition without onboarding reads: nothing is registered, nothing is recorded. */
const NO_TOUR: GuidedTourHooks = {
  useRegisterActions: () => undefined,
  useRecordVirtualKeyReveal: () => async () => undefined,
};

/** The guided tour hooks onboarding lends, or ones that do nothing. Call them during render. */
export function useLentGuidedTour(): GuidedTourHooks {
  return useLentHooks(GuidedTourToken) ?? NO_TOUR;
}
