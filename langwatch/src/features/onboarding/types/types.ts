export enum OnboardingScreenIndex {
  ORGANIZATION = 0,
  BASIC_INFO = 1,
  DESIRES = 2,
  ROLE = 3,
}

export enum OnboardingFlowDirection {
  FORWARD = 1,
  BACKWARD = -1,
}

export const USAGE_STYLES = [
  "For myself",
  "For my clients",
  "For my company",
] as const;
export const COMPANY_SIZES = [
  "1_to_10",
  "11_to_50",
  "51_to_200",
  "201_to_1000",
  "1000_to_5000",
  "5000_plus",
] as const;
export const SOLUTION_TYPES = ["SaaS", "On-Premise"] as const;
export const DESIRE_TYPES = [
  "everything",
  "evaluations",
  "model_experimentation",
  "prompt_management_optimization",
  "agent_simulations",
  "observability",
  "safety_compliance",
  "annotation_collaboration",
  "just_exploring",
] as const;
export const ROLE_TYPES = [
  "product_manager",
  "software_engineer",
  "ai_engineer",
  "engineering_manager",
  "data_scientist",
  "ai_researcher",
  "cto_clevel",
  "other",
] as const;

export type UsageStyle = (typeof USAGE_STYLES)[number];
export type CompanySize = (typeof COMPANY_SIZES)[number];
export type SolutionType = (typeof SOLUTION_TYPES)[number];
export type DesireType = (typeof DESIRE_TYPES)[number];
export type RoleType = (typeof ROLE_TYPES)[number];

export interface OnboardingFormData {
  organizationName?: string;
  agreement?: boolean;
  usageStyle?: UsageStyle;
  phoneNumber?: string;
  companySize?: CompanySize;
  solutionType?: SolutionType;
  selectedDesires: DesireType[];
  role?: RoleType;
  utmCampaign?: string | null;
}

export interface OnboardingScreen {
  id: string;
  required: boolean;
  component: React.ReactNode;
  heading: string;
  subHeading?: string;
}

export interface FormItem<T> {
  title: string;
  value: T;
}

export interface IconFormItem<TValue> extends FormItem<TValue> {
  icon: React.ComponentType;
}

export interface OnboardingFlowState {
  currentScreenIndex: number;
  direction: number;
}

export interface OnboardingNavigation {
  nextScreen: () => void;
  prevScreen: () => void;
  skipScreen: () => void;
  canProceed: () => boolean;
}

export type OnboardingFlowVariant = "full" | "self_hosted";

export interface OnboardingFlowConfig {
  variant: OnboardingFlowVariant;
  visibleScreens: OnboardingScreenIndex[];
  first: OnboardingScreenIndex;
  last: OnboardingScreenIndex;
  total: number;
}
