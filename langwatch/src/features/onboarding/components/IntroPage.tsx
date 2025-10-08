import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { OrganizationOnboardingContainer } from "./OnboardingContainer";
import { OnboardingNavigation } from "./OnboardingNavigation";
import { useOnboardingFlow } from "../hooks/use-onboarding-flow";
import { createIntroScreens } from "../screens/intro-screens";
import { slideVariants, transition } from "../constants/onboarding-data";
import {
  VStack,
} from "@chakra-ui/react";
import { motion, AnimatePresence } from "motion/react";
import React from "react";

export const IntroPage: React.FC = () => {
  const { isLoading: organizationIsLoading } = useOrganizationTeamProject({
    redirectToProjectOnboarding: false,
  });

  const {
    setUsageStyle,
    setPhoneNumber,
    setCompanySize,
    setSolutionType,
    setDesires,
    setRole,
    currentScreen,
    direction,
    navigation,
    getFormData,
  } = useOnboardingFlow();

  const screens = createIntroScreens({
    formData: getFormData(),
    handlers: {
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
      title="Let's tailor your experience"
    >
        <VStack gap={4} align="stretch" position="relative" minH="400px">
          <AnimatePresence initial={false} custom={direction} mode="wait">
            <motion.div
              key={currentScreen}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transition}
              style={{ width: "100%" }}
            >
              {screens[currentScreen]?.component}
            </motion.div>
          </AnimatePresence>

        <OnboardingNavigation
          currentScreen={currentScreen}
          totalScreens={screens.length}
          onPrev={navigation.prevScreen}
          onNext={navigation.nextScreen}
          onSkip={navigation.skipScreen}
          canProceed={navigation.canProceed()}
          isSkippable={!screens[currentScreen]?.required}
        />
      </VStack>
    </OrganizationOnboardingContainer>
  );
};
