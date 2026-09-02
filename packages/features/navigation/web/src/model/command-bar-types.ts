import type { LucideIcon } from "lucide-react";
import { z } from "zod";
import type { FrontendFeatureFlag } from "@langwatch/feature-flag-contract";

/**
 * A drawer named as an ADDRESS, not as a component.
 *
 * The catalogue names drawers other families own — the agent picker, the
 * prompt editor, the trace detail. A shell package may not reach for any of
 * them, and it does not have to: `?drawer.open=<name>` IS the address, and the
 * host resolves the name against whatever registry the application composed.
 * So the type is the name, and the resolution is the host's.
 */
export type CommandDrawerName = string;

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
  /** External URL (opens in new tab) */
  externalUrl?: string;
  /** Action function for action commands */
  action?: () => void;
  /**
   * Release flag that decides whether the command is offered, and the value
   * the command needs. A destination that replaces another one is offered on
   * `enabled: true`, and the one it replaces on `enabled: false`, so Quick
   * Search never lists two routes to the same work.
   */
  featureFlag?: { flag: FrontendFeatureFlag; enabled: boolean };
}

export const RecentItemTypeSchema = z.enum([
  "page",
  "entity",
  "project",
  "trace",
  "span",
  "simulation-run",
]);

export const RecentItemSchema = z.object({
  id: z.string(),
  type: RecentItemTypeSchema,
  label: z.string(),
  description: z.string().optional(),
  path: z.string(),
  iconName: z.string(),
  accessedAt: z.number(),
  projectSlug: z.string().optional(),
});

export type RecentItemType = z.infer<typeof RecentItemTypeSchema>;
export type RecentItem = z.infer<typeof RecentItemSchema>;

export interface SearchResult {
  id: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  path: string;
  type: "prompt" | "agent" | "dataset" | "workflow" | "evaluator" | "trace";
  /** If set, opens a drawer instead of navigating */
  drawerAction?: {
    drawer: CommandDrawerName;
    params: Record<string, string>;
  };
}
