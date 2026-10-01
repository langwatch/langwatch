/**
 * The tour's state, published for Langy's tour card: whether a tour is on screen and a replay of
 * one, recorded on the organization. Hooks, read during render.
 * @see specs/langy/langy-guided-onboarding.feature
 */
import type { UiGuidedTour } from "@langwatch/browser-host/declarations";
import { guidedPathSchema } from "@langwatch/onboarding-contract";

import { onboardingApi } from "../../../behavior/onboarding-api.ts";
import { useGuidedTourStore } from "./guided-tour-store.ts";

export const onboardingGuidedTour: UiGuidedTour = {
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
};
