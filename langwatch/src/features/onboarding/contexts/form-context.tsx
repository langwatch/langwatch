import React, { createContext, useContext } from "react";
import {
  type OnboardingFormData,
  type UsageStyle,
  type CompanySize,
  type SolutionType,
  type DesireType,
  type RoleType,
} from "../types/types";

interface OnboardingFormContextValue extends OnboardingFormData {
  setOrganizationName: (value: string) => void;
  setAgreement: (value: boolean) => void;
  setUsageStyle: (value: UsageStyle | undefined) => void;
  setPhoneNumber: (value: string) => void;
  setPhoneHasValue: (value: boolean) => void;
  setPhoneIsValid: (value: boolean) => void;
  setCompanySize: (value: CompanySize) => void;
  setSolutionType: (value: SolutionType | undefined) => void;
  setDesires: (value: DesireType[]) => void;
  setRole: (value: RoleType | undefined) => void;
}

const OnboardingFormContext = createContext<OnboardingFormContextValue | null>(
  null,
);

export function useOnboardingFormContext(): OnboardingFormContextValue {
  const ctx = useContext(OnboardingFormContext);
  if (!ctx) throw new Error("OnboardingFormContext not found");
  return ctx;
}

type Handlers = {
  setOrganizationName: (value: string) => void;
  setAgreement: (value: boolean) => void;
  setUsageStyle: (value: UsageStyle | undefined) => void;
  setPhoneNumber: (value: string) => void;
  setPhoneHasValue: (value: boolean) => void;
  setPhoneIsValid: (value: boolean) => void;
  setCompanySize: (value: CompanySize) => void;
  setSolutionType: (value: SolutionType | undefined) => void;
  setDesires: (value: DesireType[]) => void;
  setRole: (value: RoleType | undefined) => void;
};

export const OnboardingFormProvider: React.FC<
  React.PropsWithChildren<{ value: OnboardingFormContextValue }>
> = ({ value, children }) => (
  <OnboardingFormContext.Provider value={value}>
    {children}
  </OnboardingFormContext.Provider>
);
