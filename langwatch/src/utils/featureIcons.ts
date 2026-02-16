/**
 * Shared icon and color definitions for features across the application.
 * This ensures consistency between the sidebar, quick access links, and recent items.
 */
import {
  BookText,
  Bot,
  CheckSquare,
  FileText,
  FolderOpen,
  Home,
  ListTree,
  type LucideIcon,
  Pencil,
  Percent,
  Play,
  PlayCircle,
  Settings,
  Table,
  TrendingUp,
  Workflow,
} from "lucide-react";

export type FeatureKey =
  | "home"
  | "analytics"
  | "traces"
  | "simulations"
  | "scenarios"
  | "simulation_runs"
  | "suites"
  | "evaluations"
  | "workflows"
  | "prompts"
  | "datasets"
  | "annotations"
  | "settings"
  | "agents"
  | "evaluators";

export type FeatureConfig = {
  icon: LucideIcon;
  color: string;
  label: string;
};

/**
 * Central configuration for feature icons and colors.
 * Used by MainMenu, QuickAccessLinks, and RecentItemsSection.
 */
export const featureIcons: Record<FeatureKey, FeatureConfig> = {
  home: {
    icon: Home,
    color: "gray.600",
    label: "Home",
  },
  analytics: {
    icon: TrendingUp,
    color: "gray.600",
    label: "Analytics",
  },
  traces: {
    icon: ListTree,
    color: "blue.500",
    label: "Traces",
  },
  simulations: {
    icon: Play,
    color: "pink.500",
    label: "Simulations",
  },
  scenarios: {
    icon: FileText,
    color: "pink.500",
    label: "Scenarios",
  },
  simulation_runs: {
    icon: PlayCircle,
    color: "pink.500",
    label: "Runs",
  },
  suites: {
    icon: FolderOpen,
    color: "pink.500",
    label: "Suites",
  },
  evaluations: {
    icon: CheckSquare,
    color: "orange.500",
    label: "Evaluations",
  },
  workflows: {
    icon: Workflow,
    color: "green.500",
    label: "Workflows",
  },
  prompts: {
    icon: BookText,
    color: "purple.500",
    label: "Prompts",
  },
  datasets: {
    icon: Table,
    color: "blue.500",
    label: "Datasets",
  },
  annotations: {
    icon: Pencil,
    color: "teal.500",
    label: "Annotations",
  },
  settings: {
    icon: Settings,
    color: "gray.600",
    label: "Settings",
  },
  agents: {
    icon: Bot,
    color: "cyan.500",
    label: "Agents",
  },
  evaluators: {
    icon: Percent,
    color: "orange.500",
    label: "Evaluators",
  },
};

/**
 * Map from RecentItemType to FeatureKey for consistent icons/colors.
 */
export const recentItemTypeToFeature: Record<string, FeatureKey> = {
  prompt: "prompts",
  workflow: "workflows",
  dataset: "datasets",
  evaluation: "evaluations",
  annotation: "annotations",
  simulation: "simulations",
};
