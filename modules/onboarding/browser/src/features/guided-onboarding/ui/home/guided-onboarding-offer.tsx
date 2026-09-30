/**
 * The orange pill under the search bar of a day-zero home in the guided variant: "Start guided
 * onboarding". Each space (project, gateway, governance, /me) offers its own path. It is hidden
 * while Langy is guiding that space, once the space is done or the hosting screen says it is
 * already in use, and while any tour is on screen. `spaceInUse` is the screen's own answer, read
 * from data it already loads: null while unknown keeps the offer hidden, so a space in use never
 * flashes the pill.
 *
 * Clicking begins the path on the organization, opens the panel docked, runs the path's tour when
 * it has one and queues the kickoff that continues the conversation already attached.
 *
 * @see specs/home/guided-onboarding-offer.feature
 */
import { chakra, HStack } from "@chakra-ui/react";
import type { UiGuidedOnboardingOfferProps } from "@langwatch/browser-host/declarations";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { AnalyticsBoundary, useAnalytics } from "react-contextual-analytics";

import { onboardingApi } from "../../../../behavior/onboarding-api.ts";
import { useOnboardingHost } from "../../../../model/onboarding-host.ts";
import { useGuidedTourStore } from "../../behavior/guided-tour-store.ts";
import { queueKickoffOnceScoped } from "../../behavior/queue-kickoff.ts";
import {
  useGuidedOnboarding,
  useGuidedOnboardingFlag,
} from "../../behavior/use-guided-onboarding.ts";
import { offeredPath } from "../../model/offered-path.ts";
import { buildKickoff, firstNameOf } from "../../model/tour-landing.ts";
import { pathHasTour } from "../../model/tour-steps.ts";

export default function GuidedOnboardingOffer(props: UiGuidedOnboardingOfferProps) {
  return (
    <AnalyticsBoundary name="onboarding_guided">
      <GuidedOnboardingOfferInner {...props} />
    </AnalyticsBoundary>
  );
}

function GuidedOnboardingOfferInner({ space, spaceInUse }: UiGuidedOnboardingOfferProps) {
  const host = useOnboardingHost();
  const { enabled, organizationId } = useGuidedOnboardingFlag();
  const { state } = useGuidedOnboarding();
  const touring = useGuidedTourStore((s) => s.running);
  const { emit } = useAnalytics();
  const utils = onboardingApi.useUtils();
  const beginPath = onboardingApi.onboarding.beginPath.useMutation();
  const recordTour = onboardingApi.onboarding.recordTour.useMutation();
  const attachConversation = onboardingApi.onboarding.attachConversation.useMutation();
  const [busy, setBusy] = useState(false);

  if (!enabled || !state || !organizationId || spaceInUse !== false || touring) return null;
  const path = offeredPath({ space, state });
  if (!path) return null;

  const begin = async () => {
    if (busy) return;
    setBusy(true);
    emit("clicked", "home_offer", { path });
    try {
      const next = await beginPath.mutateAsync({ organizationId, path });
      await utils.onboarding.getGuidedState.invalidate({ organizationId });
      const queue = (tourStatus: "completed" | "skipped" | "none") =>
        queueKickoffOnceScoped({
          host,
          organizationId,
          attachConversation: attachConversation.mutate,
          kickoff: buildKickoff({
            path,
            state: next,
            orgName: host.scope().organization?.name ?? "",
            firstName: firstNameOf(host.currentUser()?.name),
            tourStatus,
          }),
        });
      host.langy().dock();
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
      host.failed({ error, fallbackTitle: "Couldn't start the guided onboarding" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <HStack justify="center" width="full" marginTop={3}>
      <chakra.button
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
      </chakra.button>
    </HStack>
  );
}
