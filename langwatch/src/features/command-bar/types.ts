import type { LucideIcon } from "lucide-react";

export type CommandCategory = "navigation" | "actions" | "search" | "projects";

export interface Command {
  id: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  category: CommandCategory;
  keywords?: string[];
  shortcut?: string;
  /** Route path for navigation commands */
  path?: string;
  /** Action function for action commands */
  action?: () => void;
}

export type RecentItemType =
  | "page"
  | "entity"
  | "project"
  | "trace"
  | "span"
  | "simulation-run";

export interface RecentItem {
  id: string;
  type: RecentItemType;
  label: string;
  /** Optional description for trace input preview, etc. */
  description?: string;
  path: string;
  /** Icon component name for serialization */
  iconName: string;
  /** Unix timestamp */
  accessedAt: number;
  projectSlug?: string;
}

export interface SearchResult {
  id: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  path: string;
  type: "prompt" | "agent" | "dataset" | "workflow" | "evaluator" | "trace";
  /** If set, opens a drawer instead of navigating */
  drawerAction?: {
    drawer: string;
    params: Record<string, string>;
  };
}
