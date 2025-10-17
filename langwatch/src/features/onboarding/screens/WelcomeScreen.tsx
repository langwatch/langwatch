import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { OrganizationOnboardingContainer } from "../components/containers/OnboardingContainer";
import { OnboardingNavigation } from "../components/navigation/OnboardingNavigation";
import { useOnboardingFlow } from "../hooks/use-onboarding-flow";
import { useCreateWelcomeScreens } from "./create-welcome-screens";
import { slideVariants, transition } from "../constants/onboarding-data";
import { VStack } from "@chakra-ui/react";
import { motion, AnimatePresence } from "motion/react";
import React, { useEffect, useState } from "react";
import { api } from "~/utils/api";
import { toaster } from "~/components/ui/toaster";
import { trackEventOnce } from "~/utils/tracking";
import { useRouter } from "next/router";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { LoadingScreen } from "~/components/LoadingScreen";
import { AnalyticsBoundary } from "react-contextual-analytics";
import { OnboardingFormProvider } from "../contexts/form-context";

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
          featureUsage: form.selectedDesires.join(", "),
          utmCampaign: form.utmCampaign,
        },
      },
      {
        onSuccess: (response) => {
          trackEventOnce("organization_initialized", {
            category: "onboarding",
            label: "organization_onboarding_completed",
          });
          window.location.href = `/${response.projectSlug}/messages`;
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

  const pendingOrSuccessful = initializeOrganization.isPending || initializeOrganization.isSuccess;

  return (
    <AnalyticsBoundary name="onboarding_welcome" sendViewedEvent>
      <OrganizationOnboardingContainer
        title={currentScreen?.heading ?? "Welcome Aboard 👋"}
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
                  isFirst: flow.first === currentScreenIndex,
                  isLast: flow.last === currentScreenIndex,
                }}
                sendViewedEvent
              >
                <OnboardingFormProvider value={formContextValue}>
                  <fieldset disabled={pendingOrSuccessful}>
                    {currentScreen?.component ? <currentScreen.component /> : null}
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
          />
        </VStack>
      </OrganizationOnboardingContainer>
    </AnalyticsBoundary>
  );
};


