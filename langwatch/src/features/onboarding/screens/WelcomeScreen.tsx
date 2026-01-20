import { VStack } from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/router";
import type React from "react";
import { useEffect, useState } from "react";
import { AnalyticsBoundary } from "react-contextual-analytics";
import { LoadingScreen } from "~/components/LoadingScreen";
import { toaster } from "~/components/ui/toaster";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";
import { trackEventOnce } from "~/utils/tracking";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { OnboardingContainer } from "../components/containers/OnboardingContainer";
import { OnboardingNavigation } from "../components/navigation/OnboardingNavigation";
import { slideVariants, transition } from "../constants/onboarding-data";
import { OnboardingFormProvider } from "../contexts/form-context";
import { useOnboardingFlow } from "../hooks/use-onboarding-flow";
import { useCreateWelcomeScreens } from "./create-welcome-screens";

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
  } = useOnboardingFlow();

  const screens = useCreateWelcomeScreens({ flow });

  const initializeOrganization =
    api.onboarding.initializeOrganization.useMutation();

  useEffect(() => {
    const hasAnyProject =
      organizations?.some((org) =>
        org.teams.some((t) => t.projects.length > 0),
      ) ?? false;
    if (!hasAnyProject) {
      setOnboardingNeeded(true);
      return;
    }

    const slug =
      project?.slug ??
      organizations?.flatMap((o) => o.teams).flatMap((t) => t.projects)[0]
        ?.slug;
    if (slug) {
      setOnboardingNeeded(false);
      void router.push(`/${slug}`);
    } else {
      setOnboardingNeeded(true);
    }
  }, [project?.slug]);

  function handleFinalizeSubmit() {
    const form = getFormData();

    initializeOrganization.mutate(
      {
        orgName: form.organizationName ?? "",
        phoneNumber: form.phoneNumber ?? "",
        signUpData: {
          usage: form.usageStyle,
          solution: form.solutionType,
          terms: form.agreement,
          companySize: form.companySize,
          yourRole: form.role,
          featureUsage: form.selectedDesires.join("\n"),
          utmCampaign: form.utmCampaign,
        },
      },
      {
        onSuccess: (response) => {
          trackEventOnce("organization_initialized", {
            category: "onboarding",
            label: "organization_onboarding_completed",
          });

          const params = new URLSearchParams({
            projectSlug: response.projectSlug,
          });

          window.location.href = `/onboarding/product?${params.toString()}`;
        },
        onError: () => {
          toaster.create({
            title: "Failed to proceed with onboarding",
            description: "Please try again or contact support",
            type: "error",
            meta: { closable: true },
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

  return (
    <AnalyticsBoundary name="onboarding_welcome" sendViewedEvent>
      <OnboardingContainer
        title={currentScreen?.heading ?? "Welcome aboard 👋"}
        subTitle={currentScreen?.subHeading}
      >
        <VStack gap={4} align="stretch" position="relative" minH="400px">
          <AnimatePresence initial={false} custom={direction} mode="popLayout">
            <motion.div
              key={currentScreenIndex}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transition}
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
                }}
                sendViewedEvent
              >
                <OnboardingFormProvider value={formContextValue}>
                  <fieldset disabled={pendingOrSuccessful}>
                    {currentScreen?.component ? (
                      <currentScreen.component />
                    ) : null}
                  </fieldset>
                </OnboardingFormProvider>
              </AnalyticsBoundary>
            </motion.div>
          </AnimatePresence>

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
        </VStack>
      </OnboardingContainer>
    </AnalyticsBoundary>
  );
};
