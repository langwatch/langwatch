import { Box, HStack, VStack } from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useEffect, useState } from "react";
import { AnalyticsBoundary } from "react-contextual-analytics";
import { LoadingScreen } from "../blocks/loading-screen";
import { useRequiredSession } from "../../behavior/use-required-session";
import { api } from "../../behavior/onboarding-api";
import { useRouter } from "../../behavior/next-router";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";
import { useOnboardingHost } from "../../model/onboarding-host";
import { OnboardingContainer } from "../blocks/onboarding-container";
import { OnboardingNavigation } from "../elements/onboarding-navigation";
import { OnboardingFormProvider } from "./form-context";
import { useOnboardingFlow } from "../../behavior/use-onboarding-flow";
import { resolveWelcomeRedirect } from "../../model/welcome-redirect";
import { useCreateWelcomeScreens } from "./create-welcome-screens";

export const WelcomeScreen: React.FC = () => {
  const host = useOnboardingHost();
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
  } = useOnboardingFlow();

  const screens = useCreateWelcomeScreens({ flow });

  const initializeOrganization = api.onboarding.initializeOrganization.useMutation();

  // Same-origin continuation (e.g. the CLI device-approval page sends a
  // fresh signup here with return_to=/cli/auth?user_code=… so the approval
  // survives onboarding). Only relative in-app paths are honored.
  const rawReturnTo = router.query.return_to;
  const returnTo =
    typeof rawReturnTo === "string" && rawReturnTo.startsWith("/") && !rawReturnTo.startsWith("//")
      ? rawReturnTo
      : null;

  useEffect(() => {
    // Wait until org data has finished loading before deciding
    if (organizationIsLoading) return;

    const decision = resolveWelcomeRedirect({
      organizations,
      currentProjectSlug: project?.slug ?? null,
    });

    if (decision.kind === "onboard") {
      setOnboardingNeeded(true);
      return;
    }
    setOnboardingNeeded(false);
    void router.push(returnTo ?? (decision.kind === "home" ? "/" : `/${decision.slug}`));
  }, [organizationIsLoading, organizations, project?.slug, returnTo]);

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
        onSuccess: (response) => {
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
        // Through the registry, not a hardcoded sentence. This threw the
        // error away and told everyone to "try again or contact support" —
        // advice that cannot resolve a plan limit, an address already in use,
        // or a name that fails validation, which are the failures this call
        // actually has. Signing up is the worst possible place to be told
        // nothing.
        onError: (error) => {
          host.failed({
            error,
            fallbackTitle: "Couldn't finish setting up your organization",
          });
        },
      },
    );
  }

  if (!session || !onboardingNeeded || (organizationIsLoading && !organization)) {
    return <LoadingScreen />;
  }

  const currentVisibleIndex = flow.visibleScreens.findIndex((s) => s === currentScreenIndex);
  const currentScreen = currentVisibleIndex >= 0 ? screens[currentVisibleIndex] : undefined;

  const isFirstScreen = currentVisibleIndex <= 0;
  const isLastScreen =
    currentVisibleIndex >= 0 &&
    currentVisibleIndex === flow.visibleScreens.length - 1 &&
    (flow.variant !== "self_hosted" || !isPublicEnvLoading);

  const pendingOrSuccessful = initializeOrganization.isPending || initializeOrganization.isSuccess;

  return (
    <AnalyticsBoundary name="onboarding_welcome" sendViewedEvent>
      <OnboardingContainer
        title={currentScreen?.heading ?? "Welcome aboard"}
        subTitle={currentScreen?.subHeading}
        showBackButton={false}
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
                    <fieldset disabled={pendingOrSuccessful} style={{ width: "100%", minWidth: 0 }}>
                      {currentScreen?.component ? <currentScreen.component /> : null}
                    </fieldset>
                  </OnboardingFormProvider>
                </AnalyticsBoundary>
              </motion.div>
            </AnimatePresence>
          </Box>

          <motion.div layout transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}>
            <OnboardingNavigation
              currentScreenIndex={currentScreenIndex}
              onPrev={navigation.prevScreen}
              onNext={navigation.nextScreen}
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
              {flow.visibleScreens.map((_, idx) => (
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
    </AnalyticsBoundary>
  );
};
