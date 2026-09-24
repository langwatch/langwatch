import { Box, HStack, VStack } from "@chakra-ui/react";
import { type UiAnalytics, useUiAnalytics } from "@langwatch/browser-host/analytics";
import { useRouter } from "@langwatch/browser-host/use-router";
import { guidedPathLanding } from "@langwatch/onboarding-contract";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { type ComponentProps, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../behavior/onboarding-api.ts";
import { registerOnboardingExperiment } from "../../behavior/onboarding-experiment-registration.ts";
import { type OnboardingAnalyticsSurface, OnboardingScreenIndex } from "../../behavior/types.ts";
import { useOnboardingFlow } from "../../behavior/use-onboarding-flow.ts";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project.ts";
import { useRequiredSession } from "../../behavior/use-required-session.ts";
import {
  type GuidedOrganization,
  ORG_SETUP_FAILED,
  useGuidedOrganizationCreate,
} from "../../features/guided-onboarding/behavior/use-guided-organization-create.ts";
import {
  resolveGuidedResume,
  type TakeoverResume,
} from "../../features/guided-onboarding/model/resume.ts";
import { GuidedTakeover } from "../../features/guided-onboarding/ui/takeover/guided-takeover.tsx";
import { TAKEOVER_FADE_MS } from "../../features/guided-onboarding/ui/takeover/takeover-stage.tsx";
import { useOnboardingHost } from "../../model/onboarding-host.ts";
import {
  resolveWelcomeRedirect,
  type WelcomeRedirectDecision,
} from "../../model/welcome-redirect.ts";
import { LoadingScreen } from "../blocks/loading-screen.tsx";
import { OnboardingContainer } from "../blocks/onboarding-container.tsx";
import { OnboardingNavigation } from "../elements/onboarding-navigation.tsx";
import { useCreateWelcomeScreens } from "./create-welcome-screens.tsx";
import { OnboardingFormProvider } from "./form-context.tsx";

/** The surface every event this flow emits names. */
const WELCOME_BOUNDARY = "onboarding_welcome";

/** The guided variant's screens without a card: Langy has the whole page. */
const TAKEOVER_SCREENS = new Set<OnboardingScreenIndex>([
  OnboardingScreenIndex.HELLO,
  OnboardingScreenIndex.VALUE,
  OnboardingScreenIndex.PROVIDER,
]);

/** A pending continuation first (the CLI device approval sends one), then the guided landing. */
function welcomeDestination({
  decision,
  returnTo,
  landing,
}: {
  decision: Exclude<WelcomeRedirectDecision, { kind: "onboard" }>;
  returnTo: string | null;
  landing: string | null;
}): string {
  if (returnTo) return returnTo;
  if (landing) return landing;
  return decision.kind === "home" ? "/" : `/${decision.slug}`;
}

/**
 * Announces the flow once and each screen it shows once. The surface's facts
 * are read at emit time: a change of screen re-announces it, a change of the
 * facts about that screen does not.
 */
function useWelcomeViews({
  analytics,
  isFlowMounted,
  surface,
}: {
  analytics: UiAnalytics;
  isFlowMounted: boolean;
  surface: OnboardingAnalyticsSurface;
}): void {
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
  const screenBoundary = surface.boundary;

  // The screen announces itself before the flow does, which is the order
  // React ran these in when they were a nested pair of boundary components.
  useEffect(() => {
    if (!isFlowMounted) return;
    analytics.track({
      action: "viewed",
      boundary: screenBoundary,
      attributes: surfaceRef.current.attributes,
    });
  }, [analytics, isFlowMounted, screenBoundary]);

  useEffect(() => {
    if (isFlowMounted) analytics.track({ action: "viewed", boundary: WELCOME_BOUNDARY });
  }, [analytics, isFlowMounted]);
}

/**
 * The takeover to draw instead of the cards: right after the tailor step in this session, or
 * resumed from the organization's own state on a fresh page load. Null draws the cards.
 */
function welcomeTakeoverProps({
  created,
  onTakeoverScreen,
  takeover,
  resumedProjectId,
  form,
  userName,
  returnTo,
}: {
  created: GuidedOrganization | null;
  onTakeoverScreen: boolean;
  takeover: TakeoverResume | null;
  resumedProjectId: string | undefined;
  form: { organizationName?: string; usageStyle?: string };
  userName: string | null | undefined;
  returnTo: string | null;
}): ComponentProps<typeof GuidedTakeover> | null {
  if (created) {
    if (!onTakeoverScreen) return null;
    return {
      organizationId: created.organizationId,
      organizationName: form.organizationName ?? "",
      projectId: resumedProjectId,
      projectSlug: created.projectSlug,
      userName,
      usageStyle: form.usageStyle,
      initialPhase: "hello",
      returnTo,
    };
  }
  if (!takeover) return null;
  return {
    organizationId: takeover.organizationId,
    organizationName: takeover.organizationName,
    projectId: takeover.projectId,
    projectSlug: takeover.projectSlug,
    userName,
    usageStyle: takeover.usageStyle,
    initialPhase: takeover.phase,
    initialPaths: takeover.paths,
    returnTo,
  };
}

function progressDotColor({ index, currentIndex }: { index: number; currentIndex: number }) {
  if (index === currentIndex) return "orange.400";
  if (index < currentIndex) return "orange.300";
  return "gray.200";
}

export const WelcomeScreen: React.FC = () => {
  const host = useOnboardingHost();
  const analytics = useUiAnalytics();
  const router = useRouter();
  const { data: session } = useRequiredSession();
  const [onboardingNeeded, setOnboardingNeeded] = useState<boolean | undefined>(void 0);

  const {
    organization,
    isLoading: organizationIsLoading,
    organizations,
    project,
  } = useOrganizationTeamProject({ redirectToOnboarding: false });

  const {
    currentScreenIndex,
    direction,
    flow,
    navigation,
    getFormData,
    formContextValue,
    isPublicEnvLoading,
    onboardingVariant,
  } = useOnboardingFlow();

  const screens = useCreateWelcomeScreens({ flow });

  const initializeOrganization = api.onboarding.initializeOrganization.useMutation();

  const guided = flow.variant === "guided";
  const { created, leavingCard, isCreating, createGuidedOrganization } =
    useGuidedOrganizationCreate({ getFormData, navigation, fadeMs: TAKEOVER_FADE_MS });

  // A guided organization whose takeover is unfinished resumes from the durable state instead of
  // being sent into the product; with the provider recorded, the resume is the landing.
  const resume = useMemo(() => resolveGuidedResume({ organizations }), [organizations]);
  const takeover = resume?.phase === "landing" ? null : resume;
  const landing =
    resume?.phase === "landing"
      ? guidedPathLanding({ path: resume.landingPath, projectSlug: resume.projectSlug })
      : null;

  // Same-origin continuation (e.g. the CLI device-approval page sends a
  // fresh signup here with return_to=/cli/auth?user_code=… so the approval
  // survives onboarding). Only relative in-app paths are honored.
  const rawReturnTo = router.query.return_to;
  const returnTo =
    typeof rawReturnTo === "string" && rawReturnTo.startsWith("/") && !rawReturnTo.startsWith("//")
      ? rawReturnTo
      : null;

  useEffect(() => {
    // Nothing is decided while the org data loads, nor for the organization this page just
    // created: the takeover runs on it, so the list catching up must not send the user away.
    if (organizationIsLoading || created) return;

    const decision: WelcomeRedirectDecision = takeover
      ? { kind: "onboard" }
      : resolveWelcomeRedirect({
          organizations,
          currentProjectSlug: project?.slug ?? null,
        });

    if (decision.kind === "onboard") {
      setOnboardingNeeded(true);
      return;
    }
    setOnboardingNeeded(false);
    const destination = welcomeDestination({ decision, returnTo, landing });
    if (destination === router.asPath) return;
    void router.push(destination);
  }, [
    organizationIsLoading,
    organizations,
    project?.slug,
    returnTo,
    created,
    takeover,
    landing,
    router,
  ]);

  function handleFinalizeSubmit() {
    const form = getFormData();
    const isGovernanceTrack = form.intent === "AGENT_GOVERNANCE";

    initializeOrganization.mutate(
      {
        orgName: form.organizationName ?? "",
        phoneNumber: form.phoneNumber ?? "",
        primaryIntent: form.intent,
        // The governance track never shows the marketing screens, so its
        // signUpData carries only terms + attribution. The LLMOps payload
        // stays byte-identical to the pre-fork flow (ADR-038 I2).
        signUpData: isGovernanceTrack
          ? {
              terms: form.agreement,
              onboardingVariant,
              ...form.attribution,
            }
          : {
              onboardingVariant,
              usage: form.usageStyle,
              solution: form.solutionType,
              terms: form.agreement,
              companySize: form.companySize,
              yourRole: form.role,
              featureUsage: form.selectedDesires.join("\n"),
              ...form.attribution,
            },
      },
      {
        onSuccess: (response) => {
          registerOnboardingExperiment(onboardingVariant);
          // `trackEventOnce("organization_initialized")` did not travel: product
          // analytics is the application's, and a port method the host could only
          // answer with nothing is worse than its absence.

          // A pending continuation (CLI device approval) outranks both
          // track landings: finish what the user actually came to do.
          if (returnTo) {
            host.hardRedirect(returnTo);
            return;
          }

          if (isGovernanceTrack) {
            // Land via "/" so the home resolver applies the org-intent rule
            // (including the kill-switch fallback) instead of hardcoding /me.
            host.hardRedirect("/");
            return;
          }

          // LLMOps signups always get a project; the null case is the
          // governance track, which returned above.
          const params = new URLSearchParams({
            projectSlug: response.projectSlug ?? "",
          });

          host.hardRedirect(`/onboarding/product?${params.toString()}`);
        },
        // Through the registry, not a hardcoded sentence. This threw the error away and told
        // everyone to "try again or contact support" — advice that cannot resolve a plan limit,
        // an address already in use, or a name that fails validation, which are the failures
        // this call actually has. Signing up is the worst possible place to be told nothing.
        onError: (error) => {
          host.failed({ error, fallbackTitle: ORG_SETUP_FAILED });
        },
      },
    );
  }

  const currentVisibleIndex = flow.visibleScreens.findIndex((s) => s === currentScreenIndex);
  const currentScreen = currentVisibleIndex >= 0 ? screens[currentVisibleIndex] : undefined;

  const isFirstScreen = currentVisibleIndex <= 0;
  const isLastScreen =
    currentVisibleIndex >= 0 &&
    currentVisibleIndex === flow.visibleScreens.length - 1 &&
    (flow.variant !== "self_hosted" || !isPublicEnvLoading);

  const screenSurface = {
    boundary: `${WELCOME_BOUNDARY}.${currentScreen?.id ?? "unknown"}`,
    attributes: {
      screenIndex: currentVisibleIndex,
      variant: flow.variant,
      total: flow.total,
      isFirst: isFirstScreen,
      isLast: isLastScreen,
      // Per-track funnel segmentation (ADR-038 I6)
      intent: formContextValue.intent ?? null,
    },
  };

  const isFlowMounted = Boolean(
    session && onboardingNeeded && !(organizationIsLoading && !organization),
  );
  useWelcomeViews({ analytics, isFlowMounted, surface: screenSurface });

  if (!isFlowMounted) {
    return <LoadingScreen />;
  }

  const takeoverProps = welcomeTakeoverProps({
    created,
    onTakeoverScreen: TAKEOVER_SCREENS.has(currentScreenIndex),
    takeover,
    resumedProjectId: resume?.projectId,
    form: getFormData(),
    userName: session?.user?.name,
    returnTo,
  });
  if (takeoverProps) return <GuidedTakeover {...takeoverProps} />;

  const pendingOrSuccessful =
    initializeOrganization.isPending || initializeOrganization.isSuccess || isCreating;

  // The guided cards only count themselves: the takeover has no dots.
  const dotScreens = guided
    ? flow.visibleScreens.filter((screen) => !TAKEOVER_SCREENS.has(screen))
    : flow.visibleScreens;
  const createsOrganizationHere = guided && currentScreenIndex === OnboardingScreenIndex.BASIC_INFO;

  return (
    <motion.div
      animate={{ opacity: leavingCard ? 0 : 1, scale: leavingCard ? 0.97 : 1 }}
      transition={{ duration: TAKEOVER_FADE_MS / 1000, ease: "easeOut" }}
    >
      <OnboardingContainer
        boundary={WELCOME_BOUNDARY}
        title={currentScreen?.heading ?? "Welcome aboard"}
        subTitle={currentScreen?.subHeading}
        showBackButton={false}
        widthVariant={guided ? "guided" : "narrow"}
      >
        <VStack gap={5} align="stretch" w="full" minW="0">
          <Box position="relative" overflow="hidden" py="1" px="2" my="-1" mx="-2">
            <AnimatePresence mode="popLayout" custom={direction} initial={false}>
              <motion.div
                key={currentScreenIndex}
                custom={direction}
                initial="enter"
                animate="center"
                exit="exit"
                layout
                variants={{
                  enter: (dir: number) => ({
                    opacity: 0,
                    x: dir > 0 ? 30 : -30,
                    filter: "blur(3px)",
                  }),
                  center: {
                    opacity: 1,
                    x: 0,
                    filter: "blur(0px)",
                  },
                  exit: (dir: number) => ({
                    opacity: 0,
                    x: dir > 0 ? -30 : 30,
                    filter: "blur(3px)",
                    position: "absolute" as const,
                    top: 0,
                    left: 0,
                    right: 0,
                  }),
                }}
                transition={{
                  duration: 0.3,
                  ease: [0.32, 0.72, 0, 1],
                }}
                style={{ width: "100%" }}
              >
                <OnboardingFormProvider value={formContextValue}>
                  <fieldset disabled={pendingOrSuccessful} style={{ width: "100%", minWidth: 0 }}>
                    {currentScreen?.component ? (
                      <currentScreen.component surface={screenSurface} />
                    ) : null}
                  </fieldset>
                </OnboardingFormProvider>
              </motion.div>
            </AnimatePresence>
          </Box>

          <motion.div layout transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}>
            <OnboardingNavigation
              boundary={WELCOME_BOUNDARY}
              currentScreenIndex={currentScreenIndex}
              onPrev={navigation.prevScreen}
              onNext={createsOrganizationHere ? createGuidedOrganization : navigation.nextScreen}
              onSkip={navigation.skipScreen}
              canProceed={navigation.canProceed()}
              isSkippable={!currentScreen?.required}
              isSubmitting={pendingOrSuccessful}
              onFinish={handleFinalizeSubmit}
              isFirstScreen={isFirstScreen}
              isLastScreen={isLastScreen}
            />
          </motion.div>

          <motion.div layout transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}>
            <HStack justify="center" gap={1.5}>
              {dotScreens.map((_, idx) => (
                <Box
                  key={idx}
                  w={currentVisibleIndex === idx ? "16px" : "5px"}
                  h="5px"
                  borderRadius="full"
                  bg={progressDotColor({ index: idx, currentIndex: currentVisibleIndex })}
                  transition="all 0.3s ease"
                />
              ))}
            </HStack>
          </motion.div>
        </VStack>
      </OnboardingContainer>
    </motion.div>
  );
};
