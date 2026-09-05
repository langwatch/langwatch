/**
 * The orange pill under the search bar of a day-zero home in the guided
 * variant: "Start guided onboarding". Each space (project, gateway,
 * governance, /me) offers its own path. Hidden while Langy is guiding that
 * same space, once that space is done, and while any tour is on screen.
 *
 * Clicking it begins the path on the organization, opens the panel docked,
 * runs the path's tour when it has one, and queues the kickoff that
 * continues the conversation the guided onboarding already attached.
 *
 * @see specs/home/guided-onboarding-offer.feature
 */
import { Box, HStack } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { AnalyticsBoundary, useAnalytics } from "react-contextual-analytics";
import { useProjectReach } from "~/components/home/useProjectReach";
import { showErrorToast } from "~/features/errors/logic/showErrorToast";
import { useLangyStore } from "~/features/langy/stores/langyStore";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import type { GuidedOnboardingState } from "~/server/schemas/sign-up-data.schema";
import { api } from "~/utils/api";
import { type GuidedSpace, guidedPathForSpace } from "../landing";
import type { GuidedPath } from "../paths";
import { buildKickoff, firstNameOf } from "../tour/GuidedOnboardingHost";
import { useGuidedTourStore } from "../tour/guidedTourStore";
import { pathHasTour } from "../tour/tourSteps";
import { useGuidedOnboarding } from "../useGuidedOnboarding";

/** The path this space offers, or none when the space is guided or done. */
export function offeredPath({
  space,
  state,
}: {
  space: GuidedSpace;
  state: GuidedOnboardingState;
}): GuidedPath | null {
  const path = guidedPathForSpace(space);
  if (state.currentPath === path) return null;
  if (state.donePaths.includes(path)) return null;
  return path;
}

export function GuidedOnboardingOffer({ space }: { space: GuidedSpace }) {
  return (
    <AnalyticsBoundary name="onboarding_guided">
      <GuidedOnboardingOfferInner space={space} />
    </AnalyticsBoundary>
  );
}

function GuidedOnboardingOfferInner({ space }: { space: GuidedSpace }) {
  const { guided, state, organizationId } = useGuidedOnboarding();
  const { isNewProject } = useProjectReach();
  const touring = useGuidedTourStore((s) => s.running);
  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const session = useRequiredSession();
  const { emit } = useAnalytics();
  const utils = api.useUtils();
  const beginPath = api.onboarding.beginPath.useMutation();
  const recordTour = api.onboarding.recordTour.useMutation();
  const [busy, setBusy] = useState(false);

  if (!guided || !state || !organizationId || !isNewProject || touring) {
    return null;
  }
  const path = offeredPath({ space, state });
  if (!path) return null;

  const begin = async () => {
    if (busy) return;
    setBusy(true);
    emit("clicked", "home_offer", { path });
    try {
      const next = await beginPath.mutateAsync({ organizationId, path });
      await utils.onboarding.getGuidedState.invalidate({ organizationId });
      const orgName = organization?.name ?? "";
      const firstName = firstNameOf(session.data?.user?.name);
      const queue = (tourStatus: "completed" | "skipped" | "none") =>
        useLangyStore
          .getState()
          .queueGuidedKickoff(
            buildKickoff({ path, state: next, orgName, firstName, tourStatus }),
          );
      const langy = useLangyStore.getState();
      langy.openPanel();
      langy.setPanelMode("sidebar");
      if (pathHasTour(path)) {
        useGuidedTourStore.getState().start(path, {
          onEnd: (status) => {
            recordTour.mutate({ organizationId, status });
            queue(status);
          },
        });
      } else {
        queue("none");
      }
    } catch (error) {
      showErrorToast({
        error,
        fallbackTitle: "Couldn't start the guided onboarding",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <HStack justify="center" width="full" marginTop={3}>
      <Box
        as="button"
        type="button"
        data-testid="guided-onboarding-offer"
        onClick={() => void begin()}
        disabled={busy}
        display="flex"
        alignItems="center"
        gap={2}
        cursor={busy ? "default" : "pointer"}
        borderRadius="full"
        borderWidth="1px"
        borderStyle="solid"
        borderColor="#f8b577"
        background="#fff3e5"
        paddingX={4}
        paddingY={2}
        fontSize="12.5px"
        fontWeight="medium"
        color="gray.900"
        opacity={busy ? 0.7 : 1}
        transition="border-color 120ms ease"
        _hover={busy ? undefined : { borderColor: "#ea580c" }}
      >
        <Sparkles size={14} color="#ea580c" aria-hidden="true" />
        Start guided onboarding
      </Box>
    </HStack>
  );
}
