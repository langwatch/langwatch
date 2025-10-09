import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { OrganizationOnboardingContainer } from "./OnboardingContainer";
import { OnboardingNavigation } from "./OnboardingNavigation";
import { useOnboardingFlow } from "../hooks/use-onboarding-flow";
import { createScreens } from "../screens/manager";
import { slideVariants, transition } from "../constants/onboarding-data";
import { VStack } from "@chakra-ui/react";
import { motion, AnimatePresence } from "motion/react";
import React from "react";
import { api } from "~/utils/api";
import { toaster } from "~/components/ui/toaster";

export const WelcomePage: React.FC = () => {
  const { isLoading: organizationIsLoading } = useOrganizationTeamProject({
    redirectToProjectOnboarding: false,
  });

  const {
    setOrganizationName,
    setAgreement,
    setUsageStyle,
    setPhoneNumber,
    setCompanySize,
    setSolutionType,
    setDesires,
    setRole,
    currentScreenIndex,
    direction,
    navigation,
    getFormData,
  } = useOnboardingFlow();

  const utmCampaign =
    typeof window !== "undefined"
      ? window.sessionStorage.getItem("utm_campaign")
      : null;

  const screens = createScreens({
    formData: getFormData(),
    handlers: {
      setOrganizationName,
      setAgreement,
      setUsageStyle,
      setPhoneNumber,
      setCompanySize,
      setSolutionType,
      setDesires,
      setRole,
    },
  });

  const initializeOrganization = api.onboarding.initializeOrganization.useMutation();

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
          utmCampaign,
        },
      },
      {
        onSuccess: (response) => {
          // window.location.href = `/${response.projectSlug}/messages`;
        },
        onError: () => {
          toaster.create({
            title: "Failed to proceed with onboarding",
            description: "Please try again or contact support",
            type: "error",
            meta: { closable: true },
          });
        },
      }
    );
  }

  return (
    <OrganizationOnboardingContainer
      loading={organizationIsLoading}
      title={screens[currentScreenIndex]?.heading ?? "Welcome Aboard 👋"}
      subTitle={screens[currentScreenIndex]?.subHeading}
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
            <fieldset disabled={initializeOrganization.isPending}>
              {screens[currentScreenIndex]?.component}
            </fieldset>
            </motion.div>
          </AnimatePresence>

        <OnboardingNavigation
          currentScreenIndex={currentScreenIndex}
          onPrev={navigation.prevScreen}
          onNext={navigation.nextScreen}
          onSkip={navigation.skipScreen}
          canProceed={navigation.canProceed()}
          isSkippable={!screens[currentScreenIndex]?.required}
          isSubmitting={initializeOrganization.isPending}
          onFinish={handleFinalizeSubmit}
        />
      </VStack>
    </OrganizationOnboardingContainer>
  );
};
