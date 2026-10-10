import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The house id scheme's kind for a dashboard. */
export const DASHBOARD_KSUID_RESOURCE = "dashboard";

export const dashboardIdSchema = z.string().min(1);
export const projectIdSchema = z.string().min(1);
export const dashboardNameSchema = z.string().trim().min(1).max(255);
export const dashboardDescriptionSchema = z.string().trim().max(2000);

/** The signed-in member a read or write is for; absent for a project credential. */
export type DashboardViewer = Readonly<{ userId: string }>;

const dashboardCreateInputSchemaDefinition = z
  .object({
    projectId: projectIdSchema,
    name: dashboardNameSchema,
  })
  .strict();
export interface DashboardCreateInputSchema extends Named<
  typeof dashboardCreateInputSchemaDefinition
> {}
export const dashboardCreateInputSchema: DashboardCreateInputSchema =
  dashboardCreateInputSchemaDefinition;

const dashboardRenameInputSchemaDefinition = z
  .object({ ...dashboardCreateInputSchema.shape, dashboardId: dashboardIdSchema })
  .strict();
export interface DashboardRenameInputSchema extends Named<
  typeof dashboardRenameInputSchemaDefinition
> {}
export const dashboardRenameInputSchema: DashboardRenameInputSchema =
  dashboardRenameInputSchemaDefinition;

const dashboardReorderInputSchemaDefinition = z
  .object({
    projectId: projectIdSchema,
    dashboardIds: z.array(dashboardIdSchema).min(1),
  })
  .strict();
export interface DashboardReorderInputSchema extends Named<
  typeof dashboardReorderInputSchemaDefinition
> {}
export const dashboardReorderInputSchema: DashboardReorderInputSchema =
  dashboardReorderInputSchemaDefinition;

/**
 * Who sees a board, narrowest first: its author alone ("Only me"), the project that owns it,
 * or every project of that project's organization. Named as the prompt scope is.
 */
export const DASHBOARD_SCOPES = ["PRIVATE", "PROJECT", "ORGANIZATION"] as const;
export const dashboardScopeSchema = z.enum(DASHBOARD_SCOPES);
export type DashboardScope = z.infer<typeof dashboardScopeSchema>;

/** Where every board starts, a member's My dashboard aside. */
export const DEFAULT_DASHBOARD_SCOPE: DashboardScope = "PROJECT";

const dashboardSchemaDefinition = z
  .object({
    id: dashboardIdSchema,
    /** The project that owns the board: only there can it be edited. */
    projectId: projectIdSchema,
    name: dashboardNameSchema,
    order: z.number().int().nonnegative(),
    description: z.string().nullable(),
    createdById: z.string().nullable(),
    scope: dashboardScopeSchema,
    /** The owning project's organization, stamped when the board is first set to Organization. */
    organizationId: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export interface DashboardSchema extends Named<typeof dashboardSchemaDefinition> {}
export const dashboardSchema: DashboardSchema = dashboardSchemaDefinition;
export type Dashboard = z.infer<typeof dashboardSchema>;

/** A project as a board names it: who owns the board, or whose data it can show. */
const dashboardProjectSchemaDefinition = z
  .object({ id: projectIdSchema, name: z.string(), slug: z.string() })
  .strict();
export interface DashboardProjectSchema extends Named<typeof dashboardProjectSchemaDefinition> {}
export const dashboardProjectSchema: DashboardProjectSchema = dashboardProjectSchemaDefinition;
export type DashboardProject = z.infer<typeof dashboardProjectSchema>;

const dashboardSummarySchemaDefinition = z
  .object({
    ...dashboardSchema.shape,
    graphCount: z.number().int().nonnegative(),
    /** Whether the member reading the list has starred this board. */
    isStarred: z.boolean(),
    /** The project that owns an Organization board listed in another project; null at home. */
    ownerProject: dashboardProjectSchema.nullable(),
  })
  .strict();
export interface DashboardSummarySchema extends Named<typeof dashboardSummarySchemaDefinition> {}
export const dashboardSummarySchema: DashboardSummarySchema = dashboardSummarySchemaDefinition;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

/** What a narrower scope takes from other members, for the confirmation that asks first. */
const dashboardScopeImpactSchemaDefinition = z
  .object({ otherStars: z.number().int().nonnegative() })
  .strict();
export interface DashboardScopeImpactSchema extends Named<
  typeof dashboardScopeImpactSchemaDefinition
> {}
export const dashboardScopeImpactSchema: DashboardScopeImpactSchema =
  dashboardScopeImpactSchemaDefinition;
export type DashboardScopeImpact = z.infer<typeof dashboardScopeImpactSchema>;

/** The projects this reader can open an Organization board under, and the one that owns it. */
const dashboardScopeProjectsSchemaDefinition = z
  .object({ ownerProject: dashboardProjectSchema, projects: z.array(dashboardProjectSchema) })
  .strict();
export interface DashboardScopeProjectsSchema extends Named<
  typeof dashboardScopeProjectsSchemaDefinition
> {}
export const dashboardScopeProjectsSchema: DashboardScopeProjectsSchema =
  dashboardScopeProjectsSchemaDefinition;
export type DashboardScopeProjects = z.infer<typeof dashboardScopeProjectsSchema>;

/**
 * A member's own default board, made the first time they open Dashboards. No column marks it, so
 * the name and its creator do; it starts Only me and in its creator's stars
 * (dashboards-v2.feature AC160b, AC170).
 */
export const MY_DASHBOARD_NAME = "My dashboard";

/** A From LangWatch template's id, as the browser's catalogue names it (`release`, `data`). */
export const dashboardTemplateIdSchema = z.string().trim().min(1).max(100);

/** What a member stars: one of the project's boards, or a From LangWatch template board. */
const dashboardStarSchemaDefinition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("board"), dashboardId: dashboardIdSchema }).strict(),
  z.object({ kind: z.literal("template"), templateId: dashboardTemplateIdSchema }).strict(),
]);
export interface DashboardStarSchema extends Named<typeof dashboardStarSchemaDefinition> {}
export const dashboardStarSchema: DashboardStarSchema = dashboardStarSchemaDefinition;
export type DashboardStar = z.infer<typeof dashboardStarSchema>;

/** One of the member's stars, in their order: a board with its row, or a template by id. */
const starredDashboardSchemaDefinition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("board"), dashboard: dashboardSchema }).strict(),
  z.object({ kind: z.literal("template"), templateId: dashboardTemplateIdSchema }).strict(),
]);
export interface StarredDashboardSchema extends Named<typeof starredDashboardSchemaDefinition> {}
export const starredDashboardSchema: StarredDashboardSchema = starredDashboardSchemaDefinition;
export type StarredDashboard = z.infer<typeof starredDashboardSchema>;

/** A board's name and description, as the inline editor saves them. */
const dashboardDetailsUpdateSchemaDefinition = z
  .object({
    name: dashboardNameSchema.optional(),
    description: dashboardDescriptionSchema.nullable().optional(),
  })
  .strict();
export interface DashboardDetailsUpdateSchema extends Named<
  typeof dashboardDetailsUpdateSchemaDefinition
> {}
export const dashboardDetailsUpdateSchema: DashboardDetailsUpdateSchema =
  dashboardDetailsUpdateSchemaDefinition;
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

const dashboardSourcePresenceSchemaDefinition = z
  .object({
    traces: dashboardSourcePresenceStateSchema,
    scenarios: dashboardSourcePresenceStateSchema,
    judges: dashboardSourcePresenceStateSchema,
    feedback: dashboardSourcePresenceStateSchema,
    gateway: dashboardSourcePresenceStateSchema,
    codingAgents: dashboardSourcePresenceStateSchema,
  })
  .strict();
export interface DashboardSourcePresenceSchema extends Named<
  typeof dashboardSourcePresenceSchemaDefinition
> {}
export const dashboardSourcePresenceSchema: DashboardSourcePresenceSchema =
  dashboardSourcePresenceSchemaDefinition;
export type DashboardSourcePresence = z.infer<typeof dashboardSourcePresenceSchema>;

// -- what `/api/dashboards` accepts ------------------------------------------

const dashboardRestNameSchemaDefinition = z.object({
  name: z.string().min(1, "name is required").max(255),
});
export interface DashboardRestNameSchema extends Named<typeof dashboardRestNameSchemaDefinition> {}
export const dashboardRestNameSchema: DashboardRestNameSchema = dashboardRestNameSchemaDefinition;

const dashboardRestReorderSchemaDefinition = z.object({
  dashboardIds: z.array(z.string().min(1)).min(1, "dashboardIds must not be empty"),
});
export interface DashboardRestReorderSchema extends Named<
  typeof dashboardRestReorderSchemaDefinition
> {}
export const dashboardRestReorderSchema: DashboardRestReorderSchema =
  dashboardRestReorderSchemaDefinition;

const dashboardRestParamsSchemaDefinition = z.object({ id: z.string().min(1) });
export interface DashboardRestParamsSchema extends Named<
  typeof dashboardRestParamsSchemaDefinition
> {}
export const dashboardRestParamsSchema: DashboardRestParamsSchema =
  dashboardRestParamsSchemaDefinition;
