import type { GuidedKickoff, GuidedKickoffTourStatus } from "@langwatch/onboarding-browser-kit";
/**
 * Mounted once above every guided landing: docks the panel, runs or skips
 * the current path's tour, records the outcome and queues the kickoff.
 * Also lends the tour its sidebar and governance actions, over the host.
 * @see specs/features/onboarding/guided-tour.feature
 */
import type { GuidedPath } from "@langwatch/onboarding-contract";
import { type MutableRefObject, useEffect, useMemo, useRef } from "react";

import { onboardingApi } from "../../../behavior/onboarding-api.ts";
import { useRequiredSession } from "../../../behavior/use-required-session.ts";
import { useOnboardingHost, type OnboardingHostApi } from "../../../model/onboarding-host.ts";
import {
  buildKickoff,
  firstNameOf,
  landingNeedsKickoff,
  landingNeedsTour,
  tourStatusForLanding,
} from "../model/tour-landing.ts";
import { TOUR_END_ACTIONS } from "../model/tour-steps.ts";
import { TourLayer } from "../ui/tour/tour-layer.tsx";
import { useGuidedTourStore } from "./guided-tour-store.ts";
import { useRegisterTourActions } from "./tour-registry.ts";
import { useGuidedOnboarding } from "./use-guided-onboarding.ts";
import { useOnboardingExperimentRegistration } from "./use-onboarding-experiment-registration.ts";

/**
 * Queues the kickoff once Langy announces it is scoped to `organizationId`.
 * Returns the release, for a kickoff still pending when the host unmounts.
 */
function queueKickoffOnceScoped({
  host,
  organizationId,
  kickoff,
}: {
  host: OnboardingHostApi;
  organizationId: string;
  kickoff: GuidedKickoff;
}): () => void {
  return host.langy().onScopeAnnounced(organizationId, () => host.langy().queueKickoff(kickoff));
}

/** A release to run when the component unmounts, set by whoever waits. */
function useReleaseOnUnmount(): MutableRefObject<() => void> {
  const release = useRef<() => void>(() => undefined);
  useEffect(() => () => release.current(), []);
  return release;
}

/**
 * The actions the host lends the tour: the sidebar group actions and the
 * governance sample choice, both over the host's own capabilities. A tour
 * cut short by the host unmounting still gets its path's end action.
 */
function useHostTourActions(host: OnboardingHostApi): void {
  const hostActions = useMemo(
    () => ({
      expandGroup: (id: string) => host.sidebar().expandGroup(id),
      collapseGroup: (id: string) => host.sidebar().collapseGroup(id),
      restoreGroups: () => host.sidebar().restoreAll(),
      showSampleData: () => host.governance().setSampleChoice(true),
      hideSampleData: () => host.governance().setSampleChoice(false),
    }),
    [host],
  );
  useRegisterTourActions(hostActions);
  useEffect(
    () => () => {
      const tour = useGuidedTourStore.getState();
      if (!tour.running || !tour.path) return;
      TOUR_END_ACTIONS[tour.path]?.({ navigate: () => undefined, actions: hostActions });
    },
    [hostActions],
  );
}

export function GuidedOnboardingHost() {
  const host = useOnboardingHost();
  const onOnboarding = host.route().pathname.startsWith("/onboarding");
  const { guided, state, organizationId } = useGuidedOnboarding();
  const organization = host.scope().organization;
  const session = useRequiredSession();
  const utils = onboardingApi.useUtils();
  const recordTour = onboardingApi.onboarding.recordTour.useMutation({
    onSuccess: () => {
      if (organizationId) {
        void utils.onboarding.getGuidedState.invalidate({ organizationId });
      }
    },
  });

  useHostTourActions(host);
  useOnboardingExperimentRegistration();

  /* one landing per path per page load: a re-render, a refetch or a double
     effect must not start a second tour or queue a second kickoff */
  const handled = useRef<Set<GuidedPath>>(new Set());
  /* a kickoff still waiting for the scope announcement when the host unmounts */
  const releasePending = useReleaseOnUnmount();

  useEffect(() => {
    if (onOnboarding || !guided || !state || !organizationId) return;
    const path = state.currentPath;
    if (!path || handled.current.has(path)) return;
    handled.current.add(path);

    const queue = (tourStatus: GuidedKickoffTourStatus) => {
      releasePending.current = queueKickoffOnceScoped({
        host,
        organizationId,
        kickoff: buildKickoff({
          path,
          state,
          orgName: organization?.name ?? "",
          firstName: firstNameOf(session.data?.user?.name),
          tourStatus,
        }),
      });
    };

    if (landingNeedsTour(state)) {
      host.langy().dock();
      useGuidedTourStore.getState().start(path, {
        onEnd: (status) => {
          recordTour.mutate({ organizationId, status });
          queue(status);
        },
      });
      return;
    }
    if (landingNeedsKickoff(state)) {
      host.langy().dock();
      queue(tourStatusForLanding(state, path));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onOnboarding, guided, state, organizationId]);

  if (onOnboarding || !guided) return null;
  return <TourLayer />;
}
