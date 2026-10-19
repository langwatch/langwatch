import {
  Bot,
  ClipboardList,
  Database,
  Gauge,
  GitPullRequest,
  ListTree,
  type LucideIcon,
  Sliders,
  Sparkles,
  SquareTerminal,
} from "lucide-react";

/**
 * The Me product's fixed pages as data: the personal sidebar and the command
 * bar both read this list, so they cannot drift. Traces lives in the personal
 * project, so its address is built from that project's slug.
 */
export interface PersonalNavItemData {
  label: string;
  icon: LucideIcon;
  keywords: readonly string[];
}

export const personalUsageNavItem = {
  label: "My Usage",
  href: "/me",
  icon: Gauge,
  keywords: ["usage", "my usage", "spend", "cost", "tokens"],
} as const;

export const personalSessionsNavItem = {
  label: "Sessions",
  href: "/me/sessions",
  icon: SquareTerminal,
  keywords: ["sessions", "coding agent sessions", "claude code", "codex"],
} as const;

export const personalPullRequestsNavItem = {
  label: "Pull Requests",
  href: "/me/pull-requests",
  icon: GitPullRequest,
  keywords: ["pull request", "pull requests", "pr", "prs", "github"],
} as const;

export const personalConfigureNavItem = {
  label: "Configure",
  href: "/me/configure",
  icon: Sliders,
  keywords: ["configure", "personal settings", "setup"],
} as const;

export const personalTracesNavItem = {
  label: "Traces",
  icon: ListTree,
  keywords: ["traces", "coding agent traces", "my traces"],
  hrefFor: (personalProjectSlug: string) => `/${personalProjectSlug}/traces`,
} as const;

/** Library pages of the personal project, each shown once the reader turned its feature on. */
export const personalLibraryNavItems = [
  {
    feature: "evaluations",
    label: "Online Evals",
    segment: "online-evaluations",
    icon: ClipboardList,
    keywords: ["online evals", "online evaluations", "evaluations", "monitors"],
  },
  {
    feature: "datasets",
    label: "Datasets",
    segment: "datasets",
    icon: Database,
    keywords: ["dataset", "data"],
  },
  {
    feature: "annotations",
    label: "Annotations",
    segment: "annotations",
    icon: Sparkles,
    keywords: ["annotation", "review", "labels"],
  },
  {
    feature: "automations",
    label: "Automations",
    segment: "automations",
    icon: Bot,
    keywords: ["automation", "triggers", "alerts"],
  },
] as const;
