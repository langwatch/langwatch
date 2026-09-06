/**
 * Mounted once inside ProjectLangyLayout, so it exists wherever the Langy
 * panel exists (project pages, the gateway, governance and /me). It reads the
 * organization's guided state and, on the landing after the guided sign-up:
 * opens the panel docked, runs the current path's tour, records how it
 * ended and queues the Langy kickoff exactly once. A path without a tour
 * (coding) and a reload after the tour with no conversation attached queue
 * the kickoff straight away.
 *
 * The tour's group actions (fold and open Build, restore it at the end) are
 * registered here: they act on the sidebar override store, which every
 * sidebar section reads, so no page has to lend them.
 *
 * @see specs/features/onboarding/guided-tour.feature
 */
import { type MutableRefObject, useEffect, useMemo, useRef } from "react";
import { useSidebarSectionOverrides } from "~/components/sidebar/sidebarSectionOverrides";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import type { GuidedOnboardingStateView } from "~/server/api/routers/onboarding/guided";
import type { GuidedOnboardingState } from "~/server/schemas/sign-up-data.schema";
import { api } from "~/utils/api";
import { usePathname } from "~/utils/compat/next-navigation";
import type { GuidedKickoff, GuidedKickoffTourStatus } from "../kickoff";
import type { GuidedPath } from "../paths";
import { useGuidedOnboarding } from "../useGuidedOnboarding";
import { useGuidedTourStore } from "./guidedTourStore";
import { TourLayer } from "./TourLayer";
import { useRegisterTourActions } from "./tourRegistry";
import { pathHasTour } from "./tourSteps";

/** The first name the greeting uses, or nothing when the account has none. */
export function firstNameOf(
  name: string | null | undefined,
): string | undefined {
  const trimmed = name?.trim();
  if (!trimmed || trimmed.includes("@")) return undefined;
  return trimmed.split(/\s+/)[0];
}

export function buildKickoff({
  path,
  state,
  orgName,
  firstName,
  tourStatus,
}: {
  path: GuidedPath;
  state: GuidedOnboardingStateView;
  orgName: string;
  firstName: string | undefined;
  tourStatus: GuidedKickoffTourStatus;
}): GuidedKickoff {
  return {
    path,
    paths: state.paths,
    provider: state.provider,
    providerModel: state.providerModel,
    orgName,
    firstName,
    tourStatus,
    gatewayUrl: state.gatewayUrl,
    /* the conversation to continue whenever the guided state has one; the
       panel drain never queries for it */
    conversationId: state.conversationId ?? null,
  };
}

/** The landing has a tour to run when the path has one and none ended yet. */
export function landingNeedsTour(state: GuidedOnboardingState): boolean {
  return (
    !!state.currentPath &&
    pathHasTour(state.currentPath) &&
    !state.tourCompletedAt &&
    !state.tourSkippedAt
  );
}

/** Whether the landing still owes the panel its kickoff. */
export function landingNeedsKickoff(state: GuidedOnboardingState): boolean {
  return !!state.currentPath && !state.conversationId;
}

/**
 * Whether Langy has announced this page's scope for `organizationId`. The
 * layout announces it from an effect that runs after the host's, and the
 * announcement resets every scoped field of the store, a queued kickoff
 * included, so a kickoff handed over before it is lost.
 */
export function langyScopedTo(
  langy: Pick<
    ReturnType<typeof useLangyStore.getState>,
    "activeConversationScope" | "scopeAnnounced"
  >,
  organizationId: string,
): boolean {
  const scope = langy.activeConversationScope;
  return (
    langy.scopeAnnounced &&
    scope?.organizationId === organizationId &&
    !!scope.userId &&
    !!scope.projectId
  );
}

/**
 * Queues the kickoff once Langy is scoped to `organizationId`: right away
 * when it already is, otherwise on the announcement. Returns the release for
 * the pending case.
 */
function queueKickoffOnceScoped({
  organizationId,
  kickoff,
}: {
  organizationId: string;
  kickoff: GuidedKickoff;
}): () => void {
  const queue = () => useLangyStore.getState().queueGuidedKickoff(kickoff);
  if (langyScopedTo(useLangyStore.getState(), organizationId)) {
    queue();
    return () => undefined;
  }
  const release = useLangyStore.subscribe((langy) => {
    if (!langyScopedTo(langy, organizationId)) return;
    release();
    queue();
  });
  return release;
}

/**
 * How the tour ended, for a landing that queues the kickoff without running
 * one: a path with no tour never had one, and a path with a tour reached this
 * point because a previous landing already ended it.
 */
export function tourStatusForLanding(
  state: GuidedOnboardingState,
  path: GuidedPath,
): GuidedKickoffTourStatus {
  if (!pathHasTour(path)) return "none";
  const skippedAndNotCompleted =
    !!state.tourSkippedAt && !state.tourCompletedAt;
  return skippedAndNotCompleted ? "skipped" : "completed";
}

/** Docks the panel, which every landing does before it tours or kicks off. */
function dockPanel(): void {
  const langy = useLangyStore.getState();
  langy.openPanel();
  langy.setPanelMode("sidebar");
}

/** A release to run when the component unmounts, set by whoever waits. */
function useReleaseOnUnmount(): MutableRefObject<() => void> {
  const release = useRef<() => void>(() => undefined);
  useEffect(() => () => release.current(), []);
  return release;
}

export function GuidedOnboardingHost() {
  const pathname = usePathname();
  const onOnboarding = pathname?.startsWith("/onboarding") ?? false;
  const { guided, state, organizationId } = useGuidedOnboarding();
  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const session = useRequiredSession();
  const utils = api.useUtils();
  const recordTour = api.onboarding.recordTour.useMutation({
    onSuccess: () => {
      if (organizationId) {
        void utils.onboarding.getGuidedState.invalidate({ organizationId });
      }
    },
  });

  /* the group actions the tour drives, on top of the persisted preference */
  const groupActions = useMemo(
    () => ({
      expandGroup: (id: string) =>
        useSidebarSectionOverrides.getState().setOverride(id, true),
      collapseGroup: (id: string) =>
        useSidebarSectionOverrides.getState().setOverride(id, false),
      restoreGroups: () => useSidebarSectionOverrides.getState().clearAll(),
    }),
    [],
  );
  useRegisterTourActions(groupActions);

  /* one landing per path per page load: React re-renders, query refetches
     and StrictMode's double effects must not start a second tour or queue a
     second kickoff */
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
      dockPanel();
      useGuidedTourStore.getState().start(path, {
        onEnd: (status) => {
          recordTour.mutate({ organizationId, status });
          queue(status);
        },
      });
      return;
    }
    if (landingNeedsKickoff(state)) {
      dockPanel();
      queue(tourStatusForLanding(state, path));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onOnboarding, guided, state, organizationId]);

  if (onOnboarding || !guided) return null;
  return <TourLayer />;
}
