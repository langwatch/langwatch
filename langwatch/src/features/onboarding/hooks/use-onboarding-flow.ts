import { useState } from "react";
import {
  type OnboardingFormData,
  type OnboardingFlowState,
  type OnboardingNavigation,
  type UsageStyle,
  type CompanySize,
  type SolutionType,
  type Desire,
  type Role,
  ONBOARDING_SCREENS,
  OnboardingScreenIndex,
  OnboardingFlowDirection,
} from "../types/types";

export const useOnboardingFlow = () => {
  // Form state
  const [organizationName, setOrganizationName] = useState<string | undefined>(void 0);
  const [agreement, setAgreement] = useState<boolean>(false);
  const [usageStyle, setUsageStyle] = useState<UsageStyle | undefined>(void 0);
  const [phoneNumber, setPhoneNumber] = useState<string | undefined>(void 0);
  const [companySize, setCompanySize] = useState<CompanySize | undefined>(void 0);
  const [solutionType, setSolutionType] = useState<SolutionType | undefined>(void 0);
  const [selectedDesires, setDesires] = useState<Desire[]>([]);
  const [role, setRole] = useState<Role | undefined>(void 0);

  // Flow state
  const [currentScreenIndex, setCurrentScreenIndex] = useState<OnboardingScreenIndex>(ONBOARDING_SCREENS.FIRST);
  const [direction, setDirection] = useState<OnboardingFlowDirection>(OnboardingFlowDirection.FORWARD);

  // Navigation functions
  const navigateTo = (newDirection: OnboardingFlowDirection) => {
    setDirection(newDirection);
    setCurrentScreenIndex(prev => prev + newDirection);
  };

  const nextScreen = () => {
    if (currentScreenIndex < ONBOARDING_SCREENS.LAST) {
      navigateTo(OnboardingFlowDirection.FORWARD);
    }
  };

  const prevScreen = () => {
    if (currentScreenIndex > ONBOARDING_SCREENS.FIRST) {
      navigateTo(OnboardingFlowDirection.BACKWARD);
    }
  };

  const skipScreen = () => {
    if (currentScreenIndex < ONBOARDING_SCREENS.LAST) {
      navigateTo(OnboardingFlowDirection.FORWARD);
    }
  };

  // Validation logic
  const canProceed = () => {
    switch (currentScreenIndex) {
      case OnboardingScreenIndex.ORGANIZATION:
        return Boolean(organizationName?.trim() && agreement);
      case OnboardingScreenIndex.BASIC_INFO:
        return usageStyle !== void 0;
      case OnboardingScreenIndex.DESIRES:
        return true;
      case OnboardingScreenIndex.ROLE:
        return true;
      default:
        return true;
    }
  };

  // Form data getter
  const getFormData = (): OnboardingFormData => ({
    organizationName,
    agreement,
    usageStyle,
    phoneNumber,
    companySize,
    solutionType,
    selectedDesires,
    role,
  });

  // Flow state getter
  const getFlowState = (): OnboardingFlowState => ({
    currentScreenIndex,
    direction,
  });

  // Navigation interface
  const navigation: OnboardingNavigation = {
    nextScreen,
    prevScreen,
    skipScreen,
    canProceed,
  };

  return {
    // Form state
    organizationName,
    setOrganizationName,
    agreement,
    setAgreement,
    usageStyle,
    setUsageStyle,
    phoneNumber,
    setPhoneNumber,
    companySize,
    setCompanySize,
    solutionType,
    setSolutionType,
    selectedDesires,
    setDesires,
    role,
    setRole,
    
    // Flow state
    currentScreenIndex,
    direction,
    
    // Navigation
    navigation,
    
    // Getters
    getFormData,
    getFlowState,
  };
};
