import type { LucideIcon } from "lucide-react";
import { z } from "zod";
import type { DrawerType } from "~/components/drawerRegistry";
import type { FrontendFeatureFlag } from "~/server/featureFlag/frontendFeatureFlags";

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
    drawer: DrawerType;
    params: Record<string, string>;
  };
}
