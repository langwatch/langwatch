export const usageStyles = ["myself", "clients", "company"] as const;
export const companySizes = [
  "starting_out",
  "2_to_10",
  "11_to_50",
  "51_to_200",
  "201_to_1000",
  "1000_plus",
] as const;
export const solutionTypes = ["cloud", "on_premise"] as const;
export const desires = [
  "everything",
  "evaluation",
  "model_experimentation",
  "prompt_management_optimization",
  "observability",
  "safety_compliance",
  "annotation",
  "just_exploring",
] as const;
export const roles = [
  "product_manager",
  "software_engineer",
  "ai_engineer",
  "engineering_manager",
  "data_scientist",
  "ai_researcher",
  "cto_founder",
  "other",
] as const;

export type UsageStyle = (typeof usageStyles)[number];
export type CompanySize = (typeof companySizes)[number];
export type SolutionType = (typeof solutionTypes)[number];
export type Desire = (typeof desires)[number];
export type Role = (typeof roles)[number];

export interface OnboardingFormData {
  usageStyle?: UsageStyle;
  phoneNumber?: string;
  companySize?: CompanySize;
  solutionType?: SolutionType;
  selectedDesires: Desire[];
  role?: Role;
}

export interface OnboardingScreen {
  id: string;
  required: boolean;
  component: React.ReactNode;
}

export interface FormItem {
  title: string;
  value: string;
}

export interface IconFormItem extends FormItem {
  icon: React.ComponentType;
}

export interface OnboardingFlowState {
  currentScreen: number;
  direction: number;
}

export interface OnboardingNavigation {
  nextScreen: () => void;
  prevScreen: () => void;
  skipScreen: () => void;
  canProceed: () => boolean;
}
