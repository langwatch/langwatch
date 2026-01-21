import type { TourStep } from "./types";

export const tourSteps: TourStep[] = [
  {
    id: "main-menu",
    targetId: "main-menu",
    title: "One Sidebar. Full Control.",
    description:
      "Jump between traces, prompts, evaluations, and more! Everything you need, one click away.",
    placement: "right",
  },
  {
    id: "traces-overview",
    targetId: "traces-overview",
    title: "See It All in Real-Time",
    description:
      "Monitor usage, tokens, costs, and performance - the metrics that matter most, all visible at once.",
    placement: "top",
  },
  {
    id: "recent-items",
    targetId: "recent-items",
    title: "Pick Up Where You Left Off",
    description:
      "Your recent items are always just one click away. Jump back into traces, prompts, workflows, and more.",
    placement: "top",
  },
  {
    id: "quick-access",
    targetId: "quick-access",
    title: "Choose Your Next Move",
    description:
      "Fast-track to the workflows that power your AI: observability, simulations, prompt management, and evaluations.",
    placement: "top",
  },
  {
    id: "learning-resources",
    targetId: "learning-resources",
    title: "Level Up & Get Help",
    description:
      "Master LangWatch with our comprehensive docs, video tutorials, and expert support - available whenever you need it.",
    placement: "top",
  },
];
