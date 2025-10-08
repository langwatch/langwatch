import { useState } from "react";
import type {
  OnboardingFormData,
  OnboardingFlowState,
  OnboardingNavigation,
  UsageStyle,
  CompanySize,
  SolutionType,
  Desire,
  Role,
} from "../types/types";

export const useOnboardingFlow = () => {
  // Form state
  const [usageStyle, setUsageStyle] = useState<UsageStyle | undefined>(void 0);
  const [phoneNumber, setPhoneNumber] = useState<string | undefined>(void 0);
  const [companySize, setCompanySize] = useState<CompanySize | undefined>(void 0);
  const [solutionType, setSolutionType] = useState<SolutionType | undefined>(void 0);
  const [selectedDesires, setDesires] = useState<Desire[]>([]);
  const [role, setRole] = useState<Role | undefined>(void 0);

  // Flow state
  const [currentScreen, setCurrentScreen] = useState(0);
  const [direction, setDirection] = useState(0);

  // Navigation functions
  const navigateTo = (newDirection: number) => {
    setDirection(newDirection);
    setCurrentScreen(prev => prev + newDirection);
  };

  const nextScreen = () => {
    if (currentScreen < 2) { // 3 screens total (0, 1, 2)
      navigateTo(1);
    }
  };

  const prevScreen = () => {
    if (currentScreen > 0) {
      navigateTo(-1);
    }
  };

  const skipScreen = () => {
    if (currentScreen < 2) {
      navigateTo(1);
    }
  };

  // Validation logic
  const canProceed = () => {
    switch (currentScreen) {
      case 0: // basic-info
        return usageStyle !== void 0;
      case 1: // desires (optional)
        return true;
      case 2: // role (optional)
        return true;
      default:
        return true;
    }
  };

  // Form data getter
  const getFormData = (): OnboardingFormData => ({
    usageStyle,
    phoneNumber,
    companySize,
    solutionType,
    selectedDesires,
    role,
  });

  // Flow state getter
  const getFlowState = (): OnboardingFlowState => ({
    currentScreen,
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
    currentScreen,
    direction,
    
    // Navigation
    navigation,
    
    // Getters
    getFormData,
    getFlowState,
  };
};
