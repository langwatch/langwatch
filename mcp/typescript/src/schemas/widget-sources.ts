/**
 * The `sources` input of the widget tools: the trace origins a widget's queries count, checked
 * here so an unknown one never reaches the platform. Spec: dashboards-v2.feature AC200j, AC200n.
 */
import { z } from "zod";

const isAllWord = (id: string) => id.trim().toLowerCase() === "all";

/** The sources the platform takes, "other" being every origin not listed before it. */
export const WIDGET_SOURCES = [
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

/**
 * The tools' `projects` input: the project ids every query of the widget reads. Absent, a query
 * keeps what it stores (a new widget reads its board's project); null makes it unset again.
 */
const ALL_NOT_STORED = 'projects holds project ids; "all" is not stored in a widget';
// run_query takes "all"; a widget stores ids. The refine carries the message for "all" as a
// string or inside the array, and adds nothing to the tool's JSON Schema.
export const widgetProjectsInput = z
  .array(z.string().min(1), {
    error: (issue) =>
      typeof issue.input === "string" && isAllWord(issue.input) ? ALL_NOT_STORED : undefined,
  })
  .min(1)
  .refine((ids) => !ids.some(isAllWord), { message: ALL_NOT_STORED })
  .nullable()
  .optional()
  .describe(
    "The project ids every query of the widget reads, each one you can read. A new widget reads its board's project. null makes it unset again, reading the board's project.",
  );

/** run_query's `projects`: project ids, or the lone word "all" in any case. */
export const runQueryProjectsInput = z.union([
  z.string().refine(isAllWord),
  z
    .array(z.string().min(1))
    .min(1)
    .refine((ids) => !ids.some(isAllWord), {
      message: '"all" stands alone; send it by itself, or list project ids',
    }),
]);
