import { useState } from "react";
import {
  type OnboardingFormData,
  type OnboardingFlowState,
  type OnboardingNavigation,
  type UsageStyle,
  type CompanySize,
  type SolutionType,
  type DesireType,
  type RoleType,
  OnboardingScreenIndex,
  OnboardingFlowDirection,
} from "../types/types";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { getOnboardingFlowConfig } from "../constants/onboarding-flow";

export const useOnboardingFlow = () => {
  const publicEnv = usePublicEnv();
  const isSaaS = publicEnv.data?.IS_SAAS;

  // Form state
  const [organizationName, setOrganizationName] = useState<string | undefined>(
    void 0,
  );
  const [agreement, setAgreement] = useState<boolean>(false);
  const [usageStyle, setUsageStyle] = useState<UsageStyle | undefined>(void 0);
  const [phoneNumber, setPhoneNumber] = useState<string | undefined>(void 0);
  const [phoneHasValue, setPhoneHasValue] = useState<boolean>(false);
  const [phoneIsValid, setPhoneIsValid] = useState<boolean>(true);
  const [companySize, setCompanySize] = useState<CompanySize | undefined>(
    void 0,
  );
  const [solutionType, setSolutionType] = useState<SolutionType | undefined>(
    void 0,
  );
  const [selectedDesires, setDesires] = useState<DesireType[]>([]);
  const [role, setRole] = useState<RoleType | undefined>(void 0);

  // Flow state
  const flow = getOnboardingFlowConfig(Boolean(isSaaS));
  const [currentScreenIndex, setCurrentScreenIndex] =
    useState<OnboardingScreenIndex>(flow.first);
  const [direction, setDirection] = useState<OnboardingFlowDirection>(
    OnboardingFlowDirection.FORWARD,
  );

  // Navigation functions
  const navigateTo = (newDirection: OnboardingFlowDirection) => {
    setDirection(newDirection);
    setCurrentScreenIndex((prev) => {
      const visible = flow.visibleScreens;
      if (visible.length === 0) return prev;

      let currentPos = visible.indexOf(prev);
      if (currentPos === -1) {
        // Default to first visible screen if current is not found
        currentPos = Math.max(0, visible.indexOf(flow.first));
      }

      let newPos = currentPos + newDirection;
      if (newPos < 0) newPos = 0;
      if (newPos > visible.length - 1) newPos = visible.length - 1;

      if (visible[newPos] === void 0) {
        console.error("Invalid screen index", newPos);
        return prev;
      }

      return visible[newPos] ?? prev;
    });
  };

  const nextScreen = () => {
    const visible = flow.visibleScreens;
    const pos = visible.indexOf(currentScreenIndex);
    if (pos === -1) {
      // If desynced, jump towards first
      setDirection(OnboardingFlowDirection.FORWARD);
      setCurrentScreenIndex(
        visible[Math.max(0, visible.indexOf(flow.first))] ?? flow.first,
      );
      return;
    }
    if (pos < visible.length - 1) {
      navigateTo(OnboardingFlowDirection.FORWARD);
    }
  };

  const prevScreen = () => {
    const visible = flow.visibleScreens;
    const pos = visible.indexOf(currentScreenIndex);
    if (pos === -1) {
      // If desynced, jump towards first
      setDirection(OnboardingFlowDirection.BACKWARD);
      setCurrentScreenIndex(
        visible[Math.max(0, visible.indexOf(flow.first))] ?? flow.first,
      );
      return;
    }
    if (pos > 0) {
      navigateTo(OnboardingFlowDirection.BACKWARD);
    }
  };

  const skipScreen = () => {
    nextScreen();
  };

  // Validation logic
  const canProceed = () => {
    switch (currentScreenIndex) {
      case OnboardingScreenIndex.ORGANIZATION:
        return Boolean(organizationName?.trim() && agreement);

      case OnboardingScreenIndex.BASIC_INFO: {
        if (usageStyle === void 0) return false;

        const showFields = usageStyle !== "For myself";
        if (!showFields) return true;

        return !(phoneHasValue && !phoneIsValid);
      }

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
    utmCampaign:
      typeof window !== "undefined"
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
    setPhoneHasValue,
    setPhoneIsValid,
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
