import { z } from "zod";

/** The house id scheme's kind for a dashboard. */
export const DASHBOARD_KSUID_RESOURCE = "dashboard";

export const dashboardIdSchema = z.string().min(1);
export const projectIdSchema = z.string().min(1);
export const dashboardNameSchema = z.string().trim().min(1).max(255);
export const dashboardDescriptionSchema = z.string().trim().max(2000);

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
    createdById: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type Dashboard = z.infer<typeof dashboardSchema>;

export const dashboardSummarySchema = z
  .object({
    ...dashboardSchema.shape,
    graphCount: z.number().int().nonnegative(),
    /** Whether the member reading the list has starred this board. */
    isStarred: z.boolean(),
  })
  .strict();
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

/**
 * A member's own default board, made the first time they open Dashboards. No column marks it, so
 * the name and its creator do; it starts in its creator's stars (dashboards-v2.feature AC160b).
 */
export const MY_DASHBOARD_NAME = "My dashboard";

/** A From LangWatch template's id, as the browser's catalogue names it (`release`, `data`). */
export const dashboardTemplateIdSchema = z.string().trim().min(1).max(100);

/** What a member stars: one of the project's boards, or a From LangWatch template board. */
export const dashboardStarSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("board"), dashboardId: dashboardIdSchema }).strict(),
  z.object({ kind: z.literal("template"), templateId: dashboardTemplateIdSchema }).strict(),
]);
export type DashboardStar = z.infer<typeof dashboardStarSchema>;

/** One of the member's stars, in their order: a board with its row, or a template by id. */
export const starredDashboardSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("board"), dashboard: dashboardSchema }).strict(),
  z.object({ kind: z.literal("template"), templateId: dashboardTemplateIdSchema }).strict(),
]);
export type StarredDashboard = z.infer<typeof starredDashboardSchema>;

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
