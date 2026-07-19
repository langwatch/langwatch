/**
 * Single source of truth for how a trace origin renders anywhere in
 * traces-v2 — the Origin column badge, the filter sidebar facet dots,
 * and any future chip. Label casing and colour come from the same row
 * here so the table can't say orange "Coding Agent" while the sidebar
 * says something else for the identical `langwatch.origin` value.
 *
 * Palettes mirror the platform-wide `~/utils/originColors.ts` mapping
 * ("evaluation" is always green, "application" always blue, etc.).
 */
export const ORIGIN_DISPLAY = {
  application: { label: "Application", colorPalette: "blue" },
  simulation: { label: "Simulation", colorPalette: "pink" },
  evaluation: { label: "Evaluation", colorPalette: "green" },
  workflow: { label: "Workflow", colorPalette: "cyan" },
  playground: { label: "Playground", colorPalette: "teal" },
  gateway: { label: "Gateway", colorPalette: "purple" },
  sample: { label: "Sample", colorPalette: "gray" },
  coding_agent: { label: "Coding Agent", colorPalette: "orange" },
  ai_tool: { label: "AI Tool", colorPalette: "yellow" },
} as const satisfies Record<string, { label: string; colorPalette: string }>;

export type KnownOrigin = keyof typeof ORIGIN_DISPLAY;

/** Display label for an origin; unknown values pass through verbatim. */
export function originLabel(origin: string): string {
  return ORIGIN_DISPLAY[origin as KnownOrigin]?.label ?? origin;
}

/** Chakra colorPalette for an origin; unknown values get neutral gray. */
export function originColorPalette(origin: string): string {
  return ORIGIN_DISPLAY[origin as KnownOrigin]?.colorPalette ?? "gray";
}
