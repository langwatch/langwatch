import { Box, HStack, VStack } from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnalyticsBoundary } from "react-contextual-analytics";
import { LoadingScreen } from "~/components/LoadingScreen";
import { showErrorToast } from "~/features/errors";
import { GuidedTakeover } from "~/features/guided-onboarding/takeover/GuidedTakeover";
import { resolveGuidedResume } from "~/features/guided-onboarding/takeover/resume";
import { TAKEOVER_FADE_MS } from "~/features/guided-onboarding/takeover/TakeoverStage";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { trackEventOnce } from "~/utils/tracking";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { OnboardingContainer } from "../components/containers/OnboardingContainer";
import { OnboardingNavigation } from "../components/navigation/OnboardingNavigation";
import { OnboardingFormProvider } from "../contexts/form-context";
import { useOnboardingFlow } from "../hooks/use-onboarding-flow";
import { OnboardingScreenIndex } from "../types/types";
import { resolveWelcomeRedirect } from "../utils/welcome-redirect";
import { useCreateWelcomeScreens } from "./create-welcome-screens";

/** The guided variant's screens without a card: Langy has the whole page. */
const TAKEOVER_SCREENS = new Set<OnboardingScreenIndex>([
  OnboardingScreenIndex.HELLO,
  OnboardingScreenIndex.VALUE,
  OnboardingScreenIndex.PROVIDER,
]);

export const WelcomeScreen: React.FC = () => {
  const router = useRouter();
  const { data: session } = useRequiredSession();
  const [onboardingNeeded, setOnboardingNeeded] = useState<boolean | undefined>(
    void 0,
  );

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

  const initializeOrganization =
    api.onboarding.initializeOrganization.useMutation();
  const utils = api.useUtils();

  const guided = flow.variant === "guided";

  // The organization the guided flow created on leaving the tailor step. Set
  // once and kept: the takeover reads it while the organization list catches
  // up, and the redirect below stands down for it.
  const [created, setCreated] = useState<{
    organizationId: string;
    projectSlug: string;
  } | null>(null);
  // The card fades out before the takeover comes in.
  const [leavingCard, setLeavingCard] = useState(false);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // A guided organization whose takeover is unfinished: a reload, a closed
  // tab or a second device resumes it from the durable state instead of
  // being sent into the product.
  const resume = useMemo(
    () => resolveGuidedResume({ organizations }),
    [organizations],
  );

  // Same-origin continuation (e.g. the CLI device-approval page sends a
  // fresh signup here with return_to=/cli/auth?user_code=… so the approval
  // survives onboarding). Only relative in-app paths are honored.
  const rawReturnTo = router.query.return_to;
  const returnTo =
    typeof rawReturnTo === "string" &&
    rawReturnTo.startsWith("/") &&
    !rawReturnTo.startsWith("//")
      ? rawReturnTo
      : null;

  useEffect(() => {
    // Wait until org data has finished loading before deciding
    if (organizationIsLoading) return;

    // The organization this page just created: the takeover is running on
    // it, so the list catching up must not send the user away.
    if (created) return;

    if (resume) {
      setOnboardingNeeded(true);
      return;
    }

    const decision = resolveWelcomeRedirect({
      organizations,
      currentProjectSlug: project?.slug ?? null,
    });

    if (decision.kind === "onboard") {
      setOnboardingNeeded(true);
      return;
    }
    setOnboardingNeeded(false);
    void router.push(
      returnTo ?? (decision.kind === "home" ? "/" : `/${decision.slug}`),
    );
  }, [
    organizationIsLoading,
    organizations,
    project?.slug,
    returnTo,
    created,
    resume,
  ]);

  function handleFinalizeSubmit() {
    const form = getFormData();
    const isGovernanceTrack = form.intent === "AGENT_GOVERNANCE";

    initializeOrganization.mutate(
      {
        orgName: form.organizationName ?? "",
        phoneNumber: form.phoneNumber ?? "",
        primaryIntent: form.intent,
        onboardingVariant,
        // The governance track never shows the marketing screens, so its
        // signUpData carries only terms + attribution. The LLMOps payload
        // stays byte-identical to the pre-fork flow (ADR-038 I2).
        signUpData: isGovernanceTrack
          ? {
              terms: form.agreement,
              ...form.attribution,
            }
          : {
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
        onSuccess: (response, variables) => {
          trackEventOnce("organization_initialized", {
            category: "onboarding",
            label: "organization_onboarding_completed",
            intent: form.intent,
            ...(variables.onboardingVariant
              ? { onboarding_variant: variables.onboardingVariant }
              : {}),
          });

          // A pending continuation (CLI device approval) outranks both
          // track landings: finish what the user actually came to do.
          if (returnTo) {
            window.location.href = returnTo;
            return;
          }

          if (isGovernanceTrack) {
            // Land via "/" so the home resolver applies the org-intent rule
            // (including the kill-switch fallback) instead of hardcoding /me.
            window.location.href = "/";
            return;
          }

          // LLMOps signups always get a project; the null case is the
          // governance track, which returned above.
          const params = new URLSearchParams({
            projectSlug: response.projectSlug ?? "",
          });

          window.location.href = `/onboarding/product?${params.toString()}`;
        },
        // Through the registry, not a hardcoded sentence. This threw the
        // error away and told everyone to "try again or contact support" —
        // advice that cannot resolve a plan limit, an address already in use,
        // or a name that fails validation, which are the failures this call
        // actually has. Signing up is the worst possible place to be told
        // nothing.
        onError: (error) => {
          showErrorToast({
            error,
            fallbackTitle: "Couldn't finish setting up your organization",
          });
        },
      },
    );
  }

  /**
   * The guided variant creates the organization and its project on leaving
   * the tailor step: the provider key is organization-scoped, the picks are
   * stored on the organization and Langy needs a project. The project is
   * created for every pick (a governance-first pick still gets one).
   */
  function handleGuidedCreate() {
    const form = getFormData();
    initializeOrganization.mutate(
      {
        orgName: form.organizationName ?? "",
        phoneNumber: form.phoneNumber ?? "",
        primaryIntent: "LLM_OPS",
        onboardingVariant: "guided",
        signUpData: {
          usage: form.usageStyle,
          solution: form.solutionType,
          terms: form.agreement,
          companySize: form.companySize,
          ...form.attribution,
        },
      },
      {
        onSuccess: (response) => {
          trackEventOnce("organization_initialized", {
            category: "onboarding",
            label: "organization_onboarding_completed",
            intent: "LLM_OPS",
            variant: "guided",
          });
          setCreated({
            organizationId: response.organizationId,
            projectSlug: response.projectSlug ?? "",
          });
          void utils.organization.getAll.invalidate();
          setLeavingCard(true);
          timers.current.push(
            window.setTimeout(() => {
              navigation.nextScreen();
              setLeavingCard(false);
            }, TAKEOVER_FADE_MS),
          );
        },
        onError: (error) => {
          showErrorToast({
            error,
            fallbackTitle: "Couldn't finish setting up your organization",
          });
        },
      },
    );
  }

  if (
    !session ||
    !onboardingNeeded ||
    (organizationIsLoading && !organization)
  ) {
    return <LoadingScreen />;
  }

  // The takeover: right after the tailor step in this session, or resumed
  // from the organization's own state on a fresh page load.
  if (created && TAKEOVER_SCREENS.has(currentScreenIndex)) {
    const form = getFormData();
    return (
      <GuidedTakeover
        organizationId={created.organizationId}
        organizationName={form.organizationName ?? ""}
        projectId={resume?.projectId}
        projectSlug={created.projectSlug}
        userName={session.user?.name}
        usageStyle={form.usageStyle}
        initialPhase="hello"
        returnTo={returnTo}
      />
    );
  }
  if (!created && resume) {
    return (
      <GuidedTakeover
        organizationId={resume.organizationId}
        organizationName={resume.organizationName}
        projectId={resume.projectId}
        projectSlug={resume.projectSlug}
        userName={session.user?.name}
        usageStyle={resume.usageStyle}
        initialPhase={resume.phase}
        initialPaths={resume.paths}
        returnTo={returnTo}
      />
    );
  }

  const currentVisibleIndex = flow.visibleScreens.findIndex(
    (s) => s === currentScreenIndex,
  );
  const currentScreen =
    currentVisibleIndex >= 0 ? screens[currentVisibleIndex] : undefined;

  const isFirstScreen = currentVisibleIndex <= 0;
  const isLastScreen =
    currentVisibleIndex >= 0 &&
    currentVisibleIndex === flow.visibleScreens.length - 1 &&
    (flow.variant !== "self_hosted" || !isPublicEnvLoading);

  const pendingOrSuccessful =
    initializeOrganization.isPending || initializeOrganization.isSuccess;

  // The guided cards only count themselves: the takeover has no dots.
  const dotScreens = guided
    ? flow.visibleScreens.filter((s) => !TAKEOVER_SCREENS.has(s))
    : flow.visibleScreens;

  const createsOrganizationHere =
    guided && currentScreenIndex === OnboardingScreenIndex.BASIC_INFO;

  return (
    <AnalyticsBoundary name="onboarding_welcome" sendViewedEvent>
      <motion.div
        animate={{
          opacity: leavingCard ? 0 : 1,
          scale: leavingCard ? 0.97 : 1,
        }}
        transition={{ duration: TAKEOVER_FADE_MS / 1000, ease: "easeOut" }}
      >
        <OnboardingContainer
          title={currentScreen?.heading ?? "Welcome aboard"}
          subTitle={currentScreen?.subHeading}
          showBackButton={false}
          widthVariant={guided ? "guided" : "narrow"}
        >
          <VStack gap={5} align="stretch" w="full" minW="0">
            <Box
              position="relative"
              overflow="hidden"
              py="1"
              px="2"
              my="-1"
              mx="-2"
            >
              <AnimatePresence
                mode="popLayout"
                custom={direction}
                initial={false}
              >
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
                  <AnalyticsBoundary
                    name={currentScreen?.id ?? "unknown"}
                    attributes={{
                      screenIndex: currentVisibleIndex,
                      variant: flow.variant,
                      total: flow.total,
                      isFirst: isFirstScreen,
                      isLast: isLastScreen,
                      // Per-track funnel segmentation (ADR-038 I6)
                      intent: formContextValue.intent ?? null,
                    }}
                    sendViewedEvent
                  >
                    <OnboardingFormProvider value={formContextValue}>
                      <fieldset
                        disabled={pendingOrSuccessful}
                        style={{ width: "100%", minWidth: 0 }}
                      >
                        {currentScreen?.component ? (
                          <currentScreen.component />
                        ) : null}
                      </fieldset>
                    </OnboardingFormProvider>
                  </AnalyticsBoundary>
                </motion.div>
              </AnimatePresence>
            </Box>

            <motion.div
              layout
              transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
            >
              <OnboardingNavigation
                currentScreenIndex={currentScreenIndex}
                onPrev={navigation.prevScreen}
                onNext={
                  createsOrganizationHere
                    ? handleGuidedCreate
                    : navigation.nextScreen
                }
                onSkip={navigation.skipScreen}
                canProceed={navigation.canProceed()}
                isSkippable={!currentScreen?.required}
                isSubmitting={pendingOrSuccessful}
                onFinish={handleFinalizeSubmit}
                isFirstScreen={isFirstScreen}
                isLastScreen={isLastScreen}
              />
            </motion.div>

            <motion.div
              layout
              transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
            >
              <HStack justify="center" gap={1.5}>
                {dotScreens.map((_, idx) => (
                  <Box
                    key={idx}
                    w={currentVisibleIndex === idx ? "16px" : "5px"}
                    h="5px"
                    borderRadius="full"
                    bg={
                      currentVisibleIndex === idx
                        ? "orange.400"
                        : idx < currentVisibleIndex
                          ? "orange.300"
                          : "gray.200"
                    }
                    transition="all 0.3s ease"
                  />
                ))}
              </HStack>
            </motion.div>
          </VStack>
        </OnboardingContainer>
      </motion.div>
    </AnalyticsBoundary>
  );
};
