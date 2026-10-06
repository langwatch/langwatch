/**
 * What onboarding lends the pages the tour visits, by `GuidedTourToken`: register the actions
 * the tour may drive, and record the key it minted. Hooks, read during render.
 */
import type { GuidedTourHooks } from "@langwatch/onboarding-contract";

import { onboardingApi } from "../../../behavior/onboarding-api.ts";
import { useRegisterTourActions } from "./tour-registry.ts";

export const onboardingGuidedTourHooks: GuidedTourHooks = {
  useRegisterActions: useRegisterTourActions,
  useRecordVirtualKeyReveal: () => {
    const utils = onboardingApi.useUtils();
    const recordReveal = onboardingApi.onboarding.recordVirtualKeyReveal.useMutation();
    return async (reveal) => {
      await recordReveal.mutateAsync(reveal);
      await utils.onboarding.getGuidedState.invalidate({ organizationId: reveal.organizationId });
    };
  },
};
