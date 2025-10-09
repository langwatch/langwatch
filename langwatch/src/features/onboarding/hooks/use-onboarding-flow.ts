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
  OnboardingScreenIndex,
  OnboardingFlowDirection,
} from "../types/types";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { getOnboardingFlowConfig } from "../constants/onboarding-flow";



export const useOnboardingFlow = () => {
  const publicEnv = usePublicEnv();
  const isSaaS = publicEnv.data?.IS_SAAS;

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
  const flow = getOnboardingFlowConfig(Boolean(isSaaS));
  const [currentScreenIndex, setCurrentScreenIndex] = useState<OnboardingScreenIndex>(flow.first);
  const [direction, setDirection] = useState<OnboardingFlowDirection>(OnboardingFlowDirection.FORWARD);

  // Navigation functions
  const navigateTo = (newDirection: OnboardingFlowDirection) => {
    setDirection(newDirection);
    setCurrentScreenIndex(prev => prev + newDirection);
  };

  const nextScreen = () => {
    if (currentScreenIndex < flow.last) {
      navigateTo(OnboardingFlowDirection.FORWARD);
    }
  };

  const prevScreen = () => {
    if (currentScreenIndex > flow.first) {
      navigateTo(OnboardingFlowDirection.BACKWARD);
    }
  };

  const skipScreen = () => {
    if (currentScreenIndex < flow.last) {
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
    utmCampaign: typeof window !== "undefined"
      ? window.sessionStorage.getItem("utm_campaign")
      : null,
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
    flow,

    // Navigation
    navigation,

    // Getters
    getFormData,
    getFlowState,
  };
};
