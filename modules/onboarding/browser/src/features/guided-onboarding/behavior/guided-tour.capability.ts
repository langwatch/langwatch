/**
 * The tour's state, published for Langy's tour card: whether a tour is on screen, a replay of
 * one, and "Later" on the model prompt, both recorded on the organization. Hooks, read in render.
 * @see specs/langy/langy-guided-onboarding.feature
 */
import type { GuidedTourState } from "@langwatch/onboarding-client";
import { guidedPathSchema } from "@langwatch/onboarding-contract";

import { onboardingApi } from "../../../behavior/onboarding-api.ts";
import { useGuidedTourStore } from "./guided-tour-store.ts";

export const onboardingGuidedTour: GuidedTourState = {
  useRunning: () => useGuidedTourStore((s) => s.running),
  useReplay: () => {
    const recordTour = onboardingApi.onboarding.recordTour.useMutation();
    return ({ path, organizationId }) => {
      const parsed = guidedPathSchema.safeParse(path);
      if (!parsed.success) return;
      useGuidedTourStore.getState().replay(parsed.data);
      if (organizationId) recordTour.mutate({ organizationId, status: "replayed" });
    };
  },
  usePutOffModelPrompt: () => {
    const utils = onboardingApi.useUtils();
    const dismiss = onboardingApi.onboarding.recordProviderPromptDismissed.useMutation({
      onSuccess: (_state, { organizationId }) =>
        void utils.onboarding.getGuidedState.invalidate({ organizationId }),
    });
    return ({ organizationId }) => dismiss.mutate({ organizationId });
  },
};
