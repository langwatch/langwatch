/**
 * The `sources` input of the widget tools: the trace origins a widget's queries count, checked
 * here so an unknown one never reaches the platform. Spec: dashboards-v2.feature AC200j, AC200n.
 */
import { z } from "zod";

/** The sources the platform takes, "other" being every origin not listed before it. */
const WIDGET_SOURCES = [
  "application",
  "simulation",
  "evaluation",
  "sample",
  "coding_agent",
  "ai_tool",
  "gateway",
  "workflow",
  "playground",
  "langy",
  "other",
] as const;

/** A trace origin a widget query can count. */
export type WidgetSource = (typeof WIDGET_SOURCES)[number];

/** The tools' `sources` input: refused at the tool when it names anything else. */
export const widgetSourcesInput = z
  .array(z.enum(WIDGET_SOURCES))
  .max(WIDGET_SOURCES.length)
  .nullable()
  .optional()
  .describe(
    `The trace origins every query of the widget counts: any of ${WIDGET_SOURCES.join(", ")} (other = any origin not listed). A new widget counts ["application"]; add "langy" to count your own conversations, as a widget about Langy's requests needs. null makes it unset again, counting the default.`,
  );
