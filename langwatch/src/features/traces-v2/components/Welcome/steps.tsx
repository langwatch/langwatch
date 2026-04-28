import type React from "react";
import { BetterTogetherStep } from "./BetterTogetherStep";
import { TryItStep } from "./TryItStep";
import { WhatAreLensesStep } from "./WhatAreLensesStep";
import { WhatsChangedStep } from "./WhatsChangedStep";

export interface WelcomeStep {
  title: string;
  subtitle: string;
  content: React.FC;
}

export const STEPS: WelcomeStep[] = [
  {
    title: "Welcome to the new Traces Experience",
    subtitle: "A faster, more explorative, more focused way to explore what your AI agents are doing.",
    content: WhatsChangedStep,
  },
  {
    title: "Forgot your contacts?",
    subtitle: "Use Lenses to create views that capture unique variants of filters, columns, density, and groupings. Then share them.",
    content: WhatAreLensesStep,
  },
  {
    title: "Better together",
    subtitle: "Traces is multiplayer — see where your teammates are exploring and share what you find without leaving the page.",
    content: BetterTogetherStep,
  },
  {
    title: "Before you dive in",
    subtitle: "A few keyboard shortcuts and one important note about alpha.",
    content: TryItStep,
  },
];
