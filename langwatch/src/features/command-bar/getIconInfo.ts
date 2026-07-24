import { Folder } from "lucide-react";
import { featureIcons, type FeatureKey } from "~/utils/featureIcons";
import { iconColors } from "./constants";
import type { Command, RecentItem, SearchResult } from "./types";

/**
 * Unified item type for keyboard navigation.
 */
export type ListItem =
  | { type: "command"; data: Command }
  | { type: "search"; data: SearchResult }
  | { type: "recent"; data: RecentItem }
  | { type: "project"; data: { slug: string; name: string; orgTeam: string } };

/**
 * Get a unique key for a list item.
 * Extracted to avoid duplicate logic in CommandGroup and CommandItem.
 */
export function getItemKey(item: ListItem): string {
  switch (item.type) {
    case "project":
      return `project-${item.data.slug}`;
    case "command":
    case "search":
    case "recent":
      return item.data.id;
  }
}

/**
 * Get icon component and color for a list item.
 */
export function getIconInfo(item: ListItem) {
  let Icon;
  let colorKey = "";

  if (item.type === "command") {
    Icon = item.data.icon;
    colorKey = item.data.id.replace("nav-", "").replace("action-new-", "").replace("action-", "");
  } else if (item.type === "search") {
    Icon = item.data.icon;
    colorKey = item.data.type;
  } else if (item.type === "recent") {
    const featureKey = item.data.iconName as FeatureKey;
    if (featureIcons[featureKey]) {
      Icon = featureIcons[featureKey].icon;
    } else {
      switch (item.data.iconName) {
        case "prompt":
          Icon = featureIcons.prompts.icon;
          break;
        case "agent":
          Icon = featureIcons.agents.icon;
          break;
        case "dataset":
          Icon = featureIcons.datasets.icon;
          break;
        case "workflow":
          Icon = featureIcons.workflows.icon;
          break;
        case "evaluator":
          Icon = featureIcons.evaluators.icon;
          break;
        case "project":
          Icon = Folder;
          break;
        default:
          Icon = featureIcons.home.icon;
      }
    }
    colorKey = item.data.iconName;
  } else if (item.type === "project") {
    Icon = Folder;
    colorKey = "project";
  }

  return {
    Icon: Icon!,
    color: iconColors[colorKey] ?? "gray.400",
  };
}
