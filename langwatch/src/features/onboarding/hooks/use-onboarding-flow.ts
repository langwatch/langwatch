import { useMemo, useState } from "react";
import {
  type OnboardingFormData,
  type OnboardingFlowState,
  type UsageStyle,
  type CompanySize,
  type SolutionType,
  type DesireType,
  type RoleType,
  OnboardingScreenIndex,
} from "../types/types";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { getOnboardingFlowConfig } from "../constants/onboarding-flow";
import { useGenericOnboardingFlow } from "./use-generic-onboarding-flow";

export const useOnboardingFlow = () => {
  const publicEnv = usePublicEnv();
  const isSaaS = publicEnv.data?.IS_SAAS;

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

  // Flow configuration (memoized)
  const flow = useMemo(
    () => getOnboardingFlowConfig(Boolean(isSaaS)),
    [isSaaS],
  );

  const canProceed = (currentScreenIndex: OnboardingScreenIndex) => {
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

  // Use generic flow hook for navigation
  const { currentScreenIndex, direction, navigation } = useGenericOnboardingFlow(
    flow,
    canProceed
  );

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

  const getFlowState = (): OnboardingFlowState => ({
    currentScreenIndex,
    direction,
  });

  const formContextValue = useMemo(
    () => ({
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
      setOrganizationName,
      setAgreement,
      setUsageStyle,
      setPhoneNumber,
      setPhoneHasValue,
      setPhoneIsValid,
      setCompanySize,
      setSolutionType,
      setDesires,
      setRole,
    }),
    [
      organizationName,
      agreement,
      usageStyle,
      phoneNumber,
      companySize,
      solutionType,
      selectedDesires,
      role,
    ],
  );
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
    formContextValue,
  };
};
