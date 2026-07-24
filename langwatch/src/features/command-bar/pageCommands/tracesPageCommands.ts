import { Calendar, List, Table, X } from "lucide-react";
import type { Command } from "../types";

export const tracesPageCommands: Command[] = [
  {
    id: "page-traces-view-list",
    label: "Switch to List View",
    description: "Show traces as conversation list",
    icon: List,
    category: "actions",
    keywords: ["view", "list", "conversation"],
  },
  {
    id: "page-traces-view-table",
    label: "Switch to Table View",
    description: "Show traces as table",
    icon: Table,
    category: "actions",
    keywords: ["view", "table", "grid"],
  },
  {
    id: "page-traces-date-7d",
    label: "Last 7 Days",
    description: "Set date range to last 7 days",
    icon: Calendar,
    category: "actions",
    keywords: ["date", "week", "7 days"],
  },
  {
    id: "page-traces-date-30d",
    label: "Last 30 Days",
    description: "Set date range to last 30 days",
    icon: Calendar,
    category: "actions",
    keywords: ["date", "month", "30 days"],
  },
  {
    id: "page-traces-date-today",
    label: "Today",
    description: "Set date range to today only",
    icon: Calendar,
    category: "actions",
    keywords: ["date", "today"],
  },
  {
    id: "page-traces-clear-filters",
    label: "Clear All Filters",
    description: "Remove all active filters",
    icon: X,
    category: "actions",
    keywords: ["filter", "clear", "reset"],
  },
];
