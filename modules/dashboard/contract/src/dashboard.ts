import { z } from "zod";

/** The house id scheme's kind for a dashboard. */
export const DASHBOARD_KSUID_RESOURCE = "dashboard";

export const dashboardIdSchema = z.string().min(1);
export const projectIdSchema = z.string().min(1);
export const dashboardNameSchema = z.string().trim().min(1).max(255);
export const dashboardDescriptionSchema = z.string().trim().max(2000);

/**
 * Boards shipped in code rather than stored: no database row, never writable.
 * The browser addresses the Agent Flight Deck by this id.
 */
export const FLIGHT_DECK_DASHBOARD_ID = "agent-flight-deck";
export const CODE_DEFINED_DASHBOARD_IDS: readonly string[] = [FLIGHT_DECK_DASHBOARD_ID];

/** Whether an id names a code-defined board, which every write refuses. */
export function isCodeDefinedDashboardId(dashboardId: string): boolean {
  return CODE_DEFINED_DASHBOARD_IDS.includes(dashboardId);
}

/**
 * Who may see a board: its creator only, the project's team, or the whole
 * organisation. Organisation is the default and what every older board keeps.
 */
export const DASHBOARD_VISIBILITIES = ["only_me", "team", "organisation"] as const;
export const dashboardVisibilitySchema = z.enum(DASHBOARD_VISIBILITIES);
export type DashboardVisibility = z.infer<typeof dashboardVisibilitySchema>;
export const DEFAULT_DASHBOARD_VISIBILITY: DashboardVisibility = "organisation";

/** The signed-in member a read or write is for; absent for a project credential. */
export type DashboardViewer = Readonly<{ userId: string }>;

export const dashboardCreateInputSchema = z
  .object({
    projectId: projectIdSchema,
    name: dashboardNameSchema,
  })
  .strict();

export const dashboardRenameInputSchema = z
  .object({ ...dashboardCreateInputSchema.shape, dashboardId: dashboardIdSchema })
  .strict();

export const dashboardReorderInputSchema = z
  .object({
    projectId: projectIdSchema,
    dashboardIds: z.array(dashboardIdSchema).min(1),
  })
  .strict();

export const dashboardSchema = z
  .object({
    id: dashboardIdSchema,
    projectId: projectIdSchema,
    name: dashboardNameSchema,
    order: z.number().int().nonnegative(),
    description: z.string().nullable(),
    visibility: dashboardVisibilitySchema,
    createdById: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type Dashboard = z.infer<typeof dashboardSchema>;

export const dashboardSummarySchema = z
  .object({ ...dashboardSchema.shape, graphCount: z.number().int().nonnegative() })
  .strict();
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

/** A board's name and description, as the inline editor saves them. */
export const dashboardDetailsUpdateSchema = z
  .object({
    name: dashboardNameSchema.optional(),
    description: dashboardDescriptionSchema.nullable().optional(),
  })
  .strict();
export type DashboardDetailsUpdate = z.infer<typeof dashboardDetailsUpdateSchema>;

/**
 * The sources the Flight Deck lights up from. `judges` is evaluations. Each
 * answers whether the project ever recorded a row, whatever the period.
 */
export const DASHBOARD_SOURCES = [
  "traces",
  "scenarios",
  "judges",
  "feedback",
  "gateway",
  "codingAgents",
] as const;
export const dashboardSourceSchema = z.enum(DASHBOARD_SOURCES);
export type DashboardSource = z.infer<typeof dashboardSourceSchema>;

/** `failed` is a query that did not answer: neither connected nor never-connected. */
export const dashboardSourcePresenceStateSchema = z.enum(["present", "absent", "failed"]);
export type DashboardSourcePresenceState = z.infer<typeof dashboardSourcePresenceStateSchema>;

export const dashboardSourcePresenceSchema = z
  .object({
    traces: dashboardSourcePresenceStateSchema,
    scenarios: dashboardSourcePresenceStateSchema,
    judges: dashboardSourcePresenceStateSchema,
    feedback: dashboardSourcePresenceStateSchema,
    gateway: dashboardSourcePresenceStateSchema,
    codingAgents: dashboardSourcePresenceStateSchema,
  })
  .strict();
export type DashboardSourcePresence = z.infer<typeof dashboardSourcePresenceSchema>;

// -- what `/api/dashboards` accepts ------------------------------------------

export const dashboardRestNameSchema = z.object({
  name: z.string().min(1, "name is required").max(255),
});

export const dashboardRestReorderSchema = z.object({
  dashboardIds: z.array(z.string().min(1)).min(1, "dashboardIds must not be empty"),
});

export const dashboardRestParamsSchema = z.object({ id: z.string().min(1) });
