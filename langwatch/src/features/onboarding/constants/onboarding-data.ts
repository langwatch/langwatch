import {
  Building2,
  Cloud,
  Gavel,
  GraduationCap,
  LifeBuoy,
  Presentation,
  Server,
  StickyNote,
  Telescope,
  TestTubeDiagonal,
  User,
  Infinity as InfinityIcon,
  Code,
  BrainCircuit,
  PencilRuler,
  ChevronsLeftRightEllipsis,
  WandSparkles,
  ChefHat,
  Kayak,
  BadgeQuestionMark,
} from "lucide-react";
import type { IconFormItem } from "../types/types";

export const usageStyleItems: IconFormItem[] = [
  {
    title: "Company",
    value: "company",
    icon: Building2,
  },
  {
    title: "Clients",
    value: "clients",
    icon: Presentation,
  },
  {
    title: "Myself",
    value: "myself",
    icon: User,
  },
];

export const companySizeItems = [
  {
    title: "Starting out",
    value: "starting_out",
  },
  {
    title: "2-10",
    value: "2_to_10",
  },
  {
    title: "11-50",
    value: "11_to_50",
  },
  {
    title: "51-200",
    value: "51_to_200",
  },
  {
    title: "201-1000",
    value: "201_to_1000",
  },
  {
    title: "1000+",
    value: "1000_plus",
  },
];

export const solutionTypeItems: IconFormItem[] = [
  {
    title: "Cloud",
    value: "cloud",
    icon: Cloud,
  },
  {
    title: "On Premise",
    value: "on_premise",
    icon: Server,
  },
];

export const desireItems: IconFormItem[] = [
  {
    title: "Evaluation",
    value: "evaluation",
    icon: Gavel,
  },
  {
    title: "Prompt Management/Optimization",
    value: "prompt_management_optimization",
    icon: GraduationCap,
  },
  {
    title: "Observability",
    value: "observability",
    icon: Telescope,
  },
  {
    title: "Model Experimentation",
    value: "model_experimentation",
    icon: TestTubeDiagonal,
  },
  {
    title: "Safety/Compliance",
    value: "safety_compliance",
    icon: LifeBuoy,
  },
  {
    title: "Annotation",
    value: "annotation",
    icon: StickyNote,
  },
  {
    title: "Just Exploring",
    value: "just_exploring",
    icon: Kayak,
  },
  {
    title: "Everything",
    value: "everything",
    icon: InfinityIcon,
  },
];

export const roleItems: IconFormItem[] = [
  {
    title: "Software Engineer",
    value: "software_engineer",
    icon: Code,
  },
  {
    title: "AI Engineer",
    value: "ai_engineer",
    icon: WandSparkles,
  },
  {
    title: "Data Scientist",
    value: "data_scientist",
    icon: ChevronsLeftRightEllipsis,
  },
  {
    title: "AI Researcher",
    value: "ai_researcher",
    icon: BrainCircuit,
  },
  {
    title: "Product Manager",
    value: "product_manager",
    icon: Presentation,
  },
  {
    title: "Engineering Manager",
    value: "engineering_manager",
    icon: PencilRuler,
  },
  {
    title: "CTO/Founder",
    value: "cto_founder",
    icon: ChefHat,
  },
  {
    title: "Other",
    value: "other",
    icon: BadgeQuestionMark,
  },
];

export const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 200 : -200,
    opacity: 0,
  }),
  center: {
    zIndex: 1,
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    zIndex: 0,
    x: direction < 0 ? 200 : -200,
    opacity: 0,
  }),
};

export const transition = {
  x: { type: "spring" as const, stiffness: 400, damping: 25 },
  opacity: { duration: 0.15 },
};
