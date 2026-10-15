/**
 * The badge colours a saved view draws in: a view filtered to one trace origin takes that
 * origin's colours, any other view a stable colour from its name.
 */
import { getColorForString } from "@langwatch/design-system/rotating-colors";

export type ViewBadgeColors = { background: string; color: string };

const ORIGIN_COLORS: Record<string, ViewBadgeColors> = {
  application: { background: "blue.subtle", color: "blue.emphasized" },
  evaluation: { background: "green.subtle", color: "green.emphasized" },
  simulation: { background: "pink.subtle", color: "pink.emphasized" },
  playground: { background: "teal.subtle", color: "teal.emphasized" },
  gateway: { background: "purple.subtle", color: "purple.emphasized" },
  workflow: { background: "cyan.subtle", color: "cyan.emphasized" },
  sample: { background: "gray.subtle", color: "gray.emphasized" },
  coding_agent: { background: "orange.subtle", color: "orange.emphasized" },
  ai_tool: { background: "yellow.subtle", color: "yellow.emphasized" },
  langy: { background: "orange.subtle", color: "orange.emphasized" },
};

export function viewBadgeColors({
  name,
  filters,
}: {
  name: string;
  filters: Readonly<Record<string, unknown>>;
}): ViewBadgeColors {
  const origin = filters["traces.origin"];
  if (Array.isArray(origin) && origin.length === 1 && typeof origin[0] === "string") {
    return ORIGIN_COLORS[origin[0]] ?? getColorForString("colors", origin[0]);
  }
  return getColorForString("colors", name);
}
