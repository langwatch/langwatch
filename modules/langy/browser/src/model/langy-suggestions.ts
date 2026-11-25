import { GitCompare, ScanSearch, ShieldCheck } from "lucide-react";
import type { ComponentType } from "react";
// Lucide dropped its brand glyphs, so the octocat comes from react-feather —
// the same mark LangyGitHubConnectCard uses, so the suggestion and the card you
// land on speak with one icon.
import { GitHub } from "react-feather";
/** Structural, so a lucide icon and a react-feather one can sit in one list. */
export type SuggestionIcon = ComponentType<{ size?: string | number }>;

/**
 * What a project must already have for an ask to be able to succeed.
 */
export type SuggestionRequirement = "nothing" | "traces" | "evaluations" | "experiments";

export interface LangySuggestion {
  icon: SuggestionIcon;
  label: string;
  prompt: string;
  /** Absent means it works from a standing start. */
  requires?: SuggestionRequirement;
  /**
   * Offer this ask only UNTIL the project has the named thing.
   */
  until?: SuggestionRequirement;
}

/**
 * The suggested actions double as onboarding: each one names a different thing Langy
 * can do — read traces, build evals, compare experiments, ship a fix as a PR — so a
 * first-time user learns the range by scanning the list.
 */
export const SUGGESTIONS: LangySuggestion[] = [
  {
    icon: ScanSearch,
    label: "Find failing traces",
    prompt: "Find recent traces that are failing their evaluations and tell me why.",
    requires: "evaluations",
  },
  {
    icon: ShieldCheck,
    label: "Set up an evaluator",
    prompt: "Suggest an evaluator for my agent and set it up.",
    requires: "traces",
  },
  {
    icon: GitCompare,
    label: "Compare two runs",
    prompt: "Compare my last two experiment runs and summarise what changed.",
    requires: "experiments",
  },
  {
    // The GitHub glyph, not a generic pull-request icon — this row is the only place a
    // first-time user learns Langy can reach their repo at all.
    icon: GitHub,
    label: "Investigate an issue and open a PR",
    prompt:
      "Investigate a problem in my agent using my traces, then open a GitHub PR that fixes it.",
    requires: "traces",
  },
];

/**
 * What to offer a project that has no data yet.
 */
export const SETUP_SUGGESTIONS: LangySuggestion[] = [
  {
    icon: ScanSearch,
    label: "Onboard your agent",
    prompt: "Help me onboard my agent and send its first trace to this project.",
    // The first trace arriving is exactly what makes this ask obsolete.
    until: "traces",
  },
  {
    icon: ShieldCheck,
    label: "Choose what to measure",
    prompt: "What should I measure about my agent, and which evaluators would you start with?",
    until: "evaluations",
  },
  {
    icon: GitCompare,
    label: "Show me around",
    prompt: "What can you do for me on this project, and where should I start?",
  },
];
