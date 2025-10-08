import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { OrganizationOnboardingContainer } from "./OnboardingContainer";
import { OnboardingNavigation } from "./OnboardingNavigation";
import { useOnboardingFlow } from "../hooks/use-onboarding-flow";
import { createScreens } from "../screens/manager";
import { slideVariants, transition } from "../constants/onboarding-data";
import { VStack } from "@chakra-ui/react";
import { motion, AnimatePresence } from "motion/react";
import React from "react";

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
              {screens[currentScreenIndex]?.component}
            </motion.div>
          </AnimatePresence>

        <OnboardingNavigation
          currentScreenIndex={currentScreenIndex}
          onPrev={navigation.prevScreen}
          onNext={navigation.nextScreen}
          onSkip={navigation.skipScreen}
          canProceed={navigation.canProceed()}
          isSkippable={!screens[currentScreenIndex]?.required}
        />
      </VStack>
    </OrganizationOnboardingContainer>
  );
};
