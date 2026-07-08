import type { OrganizationIntent } from "@prisma/client";
import { useMemo, useState } from "react";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { readAttribution } from "~/utils/attribution";
import { getOnboardingFlowConfig } from "../constants/onboarding-flow";
import {
  type CompanySize,
  type DesireType,
  type OnboardingFlowState,
  type OnboardingFormData,
  OnboardingScreenIndex,
  type RoleType,
  type SolutionType,
  type UsageStyle,
} from "../types/types";
import { useGenericOnboardingFlow } from "./use-generic-onboarding-flow";

export const useOnboardingFlow = () => {
  const publicEnv = usePublicEnv();
  const isSaaS = publicEnv.data?.IS_SAAS;

  const [organizationName, setOrganizationName] = useState<string | undefined>(
    void 0,
  );
  const [agreement, setAgreement] = useState<boolean>(false);
  const [intent, setIntent] = useState<OrganizationIntent | undefined>(void 0);
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

  // The whole intent fork ships dark behind the governance flag (ADR-038
  // v5): flag off (or loading, which reports enabled=false) = the exact
  // pre-fork flow. User-level evaluation — there is no org yet during
  // onboarding.
  const { enabled: intentForkEnabled } = useFeatureFlag(
    "release_ui_ai_governance_enabled",
  );

  // Flow configuration — recomputed when the intent changes (ADR-038 fork).
  // Safe mid-flow: intent only changes while ON the INTENT screen, whose
  // index exists in every config variant.
  const flow = useMemo(
    () => getOnboardingFlowConfig(Boolean(isSaaS), intent, intentForkEnabled),
    [isSaaS, intent, intentForkEnabled],
  );

  const canProceed = (currentScreenIndex: OnboardingScreenIndex) => {
    switch (currentScreenIndex) {
      case OnboardingScreenIndex.ORGANIZATION:
        return Boolean(organizationName?.trim() && agreement);

      case OnboardingScreenIndex.INTENT:
        return intent !== void 0;

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
  const { currentScreenIndex, direction, navigation } =
    useGenericOnboardingFlow(flow, canProceed);

  // Snapshot first-touch attribution once per mount. `readAttribution` is a
  // pure sessionStorage read; memoizing keeps getFormData / formContextValue
  // consuming the same object and avoids six storage reads per render.
  const attribution = useMemo(() => readAttribution(), []);

  const getFormData = (): OnboardingFormData => ({
    organizationName,
    agreement,
    intent,
    usageStyle,
    phoneNumber,
    companySize,
    solutionType,
    selectedDesires,
    role,
    attribution,
  });

  const getFlowState = (): OnboardingFlowState => ({
    currentScreenIndex,
    direction,
  });

  const formContextValue = useMemo(
    () => ({
      organizationName,
      agreement,
      intent,
      usageStyle,
      phoneNumber,
      companySize,
      solutionType,
      selectedDesires,
      role,
      attribution,
      setOrganizationName,
      setAgreement,
      setIntent,
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
      intent,
      usageStyle,
      phoneNumber,
      companySize,
      solutionType,
      selectedDesires,
      role,
      attribution,
    ],
  );
  return {
    // Form state
    organizationName,
    setOrganizationName,
    agreement,
    setAgreement,
    intent,
    setIntent,
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
    isPublicEnvLoading: publicEnv.isLoading,

    // Navigation
    navigation,

    // Getters
    getFormData,
    getFlowState,
    formContextValue,
  };
};
