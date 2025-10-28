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
  HatGlasses,
} from "lucide-react";
import type {
  FormItem,
  IconFormItem,
  UsageStyle,
  SolutionType,
  CompanySize,
  RoleType,
  DesireType,
} from "../types/types";

export const usageStyleItems: IconFormItem<UsageStyle>[] = [
  {
    title: "Company",
    value: "For my company",
    icon: Building2,
  },
  {
    title: "Clients",
    value: "For my clients",
    icon: Presentation,
  },
  {
    title: "Myself",
    value: "For myself",
    icon: User,
  },
];

export const companySizeItems: FormItem<CompanySize>[] = [
  {
    title: "1-10",
    value: "1_to_10",
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
    title: "1000-5000",
    value: "1000_to_5000",
  },
  {
    title: "5000+",
    value: "5000_plus",
  },
];

export const solutionTypeItems: IconFormItem<SolutionType>[] = [
  {
    title: "Cloud",
    value: "SaaS",
    icon: Cloud,
  },
  {
    title: "On Premise",
    value: "On-Premise",
    icon: Server,
  },
];

export const desireItems: IconFormItem<DesireType>[] = [
  {
    title: "Agent Simulations",
    value: "agent_simulations",
    icon: HatGlasses,
  },
  {
    title: "Evaluations",
    value: "evaluations",
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
    title: "Annotation & Collaboration",
    value: "annotation_collaboration",
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

export const roleItems: IconFormItem<RoleType>[] = [
  {
    title: "Software Engineer",
    value: "Software Engineer",
    icon: Code,
  },
  {
    title: "AI Engineer",
    value: "AI Engineer",
    icon: WandSparkles,
  },
  {
    title: "Data Scientist",
    value: "Data Scientist",
    icon: ChevronsLeftRightEllipsis,
  },
  {
    title: "AI Researcher",
    value: "AI Researcher",
    icon: BrainCircuit,
  },
  {
    title: "Product Manager",
    value: "Product Manager",
    icon: Presentation,
  },
  {
    title: "Engineering Manager",
    value: "Engineering Manager",
    icon: PencilRuler,
  },
  {
    title: "CTO/C-Level",
    value: "CTO/Founder",
    icon: ChefHat,
  },
  {
    title: "Other",
    value: "Other",
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
