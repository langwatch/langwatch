import type React from "react";
import { BetterTogetherStep } from "./BetterTogetherStep";
import { DensityChoiceStep } from "./DensityChoiceStep";
import { FilteringStep } from "./FilteringStep";
import { TryItStep } from "./TryItStep";
import { WhatAreLensesStep } from "./WhatAreLensesStep";
import { WhatsChangedStep } from "./WhatsChangedStep";

export interface WelcomeStepProps {
  /** Step content calls this once the user has answered any required prompt. */
  markAnswered: () => void;
}

export interface WelcomeStep {
  title: string;
  subtitle: string;
  content: React.FC<WelcomeStepProps>;
  /** When true, Next/Finish is disabled until the step calls `markAnswered`. */
  requiresAnswer?: boolean;
}

export const STEPS: WelcomeStep[] = [
  {
    title: "What's new in Traces",
    subtitle: "Lens-based views, a side-by-side layout, and live updates.",
    content: WhatsChangedStep,
  },
  {
    title: "Pick your destiny",
    subtitle:
      "Compact fits more rows. Comfortable gives each row more room. You can change it any time.",
    content: DensityChoiceStep,
    requiresAnswer: true,
  },
  {
    title: "Filtering",
    subtitle:
      "Tick a facet, type an expression, or just describe it — they all build the same filter.",
    content: FilteringStep,
  },
  {
    title: "Lenses",
    subtitle:
      "Saved views with their own filters, columns, sort, and grouping.",
    content: WhatAreLensesStep,
  },
  {
    title: "Multiplayer",
    subtitle:
      "Your teammates show up where you do. Share what you find without leaving the page.",
    content: BetterTogetherStep,
  },
  {
    title: "Before you start",
    subtitle: "Shortcuts and a note about beta.",
    content: TryItStep,
  },
];
