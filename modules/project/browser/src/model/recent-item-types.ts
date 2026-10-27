import {
  BookText,
  CheckSquare,
  Home,
  type LucideIcon,
  Pencil,
  Play,
  Table,
  Workflow,
} from "lucide-react";

import type { RecentItemType } from "../behavior/home-api.ts";

/** Each recent item's icon and singular label, matching the sidebar's feature icons. */
export const recentItemTypes: Record<RecentItemType, { icon: LucideIcon; label: string }> = {
  prompt: { icon: BookText, label: "Prompt" },
  workflow: { icon: Workflow, label: "Workflow" },
  dataset: { icon: Table, label: "Dataset" },
  evaluation: { icon: CheckSquare, label: "Online Evaluation" },
  annotation: { icon: Pencil, label: "Annotation" },
  simulation: { icon: Play, label: "Simulation" },
};

export const fallbackRecentItemType: { icon: LucideIcon; label: string } = {
  icon: Home,
  label: "Item",
};
