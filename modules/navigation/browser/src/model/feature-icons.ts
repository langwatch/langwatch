/**
 * Shared icon and color definitions for features across the application.
 * This ensures consistency between the sidebar, quick access links, and recent items.
 */
import {
  Bird,
  BookText,
  Bot,
  CheckSquare,
  Drama,
  FlaskConical,
  FolderOpen,
  Home,
  Inbox,
  ListChecks,
  ListTree,
  type LucideIcon,
  Pencil,
  Percent,
  Play,
  PlayCircle,
  Settings,
  Table,
  TrainFront,
  TrendingUp,
  Workflow,
  Zap,
} from "lucide-react";

export type FeatureKey =
  | "home"
  | "insights"
  | "analytics"
  | "traces"
  | "traces_v2"
  | "simulations"
  | "agent_testing"
  | "scenarios"
  | "simulation_runs"
  | "suites"
  | "experiments"
  | "online_evaluations"
  | "workflows"
  | "prompts"
  | "datasets"
  | "annotations"
  | "settings"
  | "agents"
  | "evaluators"
  | "automations"
  | "gateway";

export type FeatureConfig = {
  icon: LucideIcon;
  color: string;
  label: string;
};

/**
 * Central configuration for feature icons and colors.
 * Used by MainMenu and RecentItemsSection.
 */
export const featureIcons: Record<FeatureKey, FeatureConfig> = {
  home: {
    icon: Home,
    color: "fg.muted",
    label: "Home",
  },
  insights: {
    icon: Inbox,
    color: "gray.600",
    label: "Insights",
  },
  analytics: {
    icon: TrendingUp,
    color: "fg.muted",
    label: "Analytics",
  },
  traces: {
    icon: ListTree,
    color: "blue.fg",
    label: "Traces",
  },
  traces_v2: {
    icon: Bird,
    color: "blue.fg",
    label: "Trace Explorer",
  },
  simulations: {
    icon: Play,
    color: "pink.fg",
    label: "Simulations",
  },
  agent_testing: {
    icon: ListChecks,
    color: "pink.fg",
    label: "Agent Testing",
  },
  scenarios: {
    icon: Drama,
    color: "pink.fg",
    label: "Scenarios",
  },
  simulation_runs: {
    icon: PlayCircle,
    color: "pink.fg",
    label: "Runs",
  },
  suites: {
    icon: FolderOpen,
    color: "pink.fg",
    label: "Run Plans",
  },
  experiments: {
    icon: FlaskConical,
    color: "green.fg",
    label: "Experiments",
  },
  online_evaluations: {
    icon: CheckSquare,
    color: "green.fg",
    label: "Online Evaluations",
  },
  workflows: {
    icon: Workflow,
    color: "blue.fg",
    label: "Workflows",
  },
  prompts: {
    icon: BookText,
    color: "purple.fg",
    label: "Prompts",
  },
  datasets: {
    icon: Table,
    color: "blue.fg",
    label: "Datasets",
  },
  annotations: {
    icon: Pencil,
    color: "teal.fg",
    label: "Annotations",
  },
  settings: {
    icon: Settings,
    color: "fg.muted",
    label: "Settings",
  },
  agents: {
    icon: Bot,
    color: "cyan.fg",
    label: "Agents",
  },
  evaluators: {
    icon: Percent,
    color: "green.fg",
    label: "Evaluators",
  },
  automations: {
    icon: Zap,
    color: "orange.fg",
    label: "Automations",
  },
  gateway: {
    icon: TrainFront,
    color: "orange.fg",
    label: "AI Gateway",
  },
};

/**
 * Map from RecentItemType to FeatureKey for consistent icons/colors.
 */
export const recentItemTypeToFeature: Record<string, FeatureKey> = {
  prompt: "prompts",
  workflow: "workflows",
  dataset: "datasets",
  evaluation: "online_evaluations",
  annotation: "annotations",
  simulation: "simulations",
};
