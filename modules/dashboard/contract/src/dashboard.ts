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

/**
 * The product whose sidebar lists a board (ADR-002, decision 8); the library orders its groups
 * itself. A board stored before homes existed is LLM Ops; only an LLM Ops board can be Project.
 */
export const DASHBOARD_HOME_PRODUCTS = ["llm-ops", "me", "gateway", "governance"] as const;
export const dashboardHomeProductSchema = z.enum(DASHBOARD_HOME_PRODUCTS);
export type DashboardHomeProduct = z.infer<typeof dashboardHomeProductSchema>;

/** Where a board is homed when nobody says, and every board made before homes existed. */
export const DEFAULT_DASHBOARD_HOME_PRODUCT: DashboardHomeProduct = "llm-ops";

/** The most boards one member's sidebar order may name. */
export const DASHBOARD_SIDEBAR_ORDER_MAX = 500;

/** Board ids in a member's own sidebar order, each named once. */
const dashboardSidebarOrderIdsSchemaDefinition = z
  .array(dashboardIdSchema)
  .max(DASHBOARD_SIDEBAR_ORDER_MAX)
  .refine((ids) => new Set(ids).size === ids.length, { message: "Each board is named once" });
export interface DashboardSidebarOrderIdsSchema extends Named<
  typeof dashboardSidebarOrderIdsSchemaDefinition
> {}
export const dashboardSidebarOrderIdsSchema: DashboardSidebarOrderIdsSchema =
  dashboardSidebarOrderIdsSchemaDefinition;

/** One member's order of a product sidebar's Dashboards section in one organization. */
const dashboardSidebarOrderSchemaDefinition = z
  .object({ dashboardIds: z.array(dashboardIdSchema) })
  .strict();
export interface DashboardSidebarOrderSchema extends Named<
  typeof dashboardSidebarOrderSchemaDefinition
> {}
export const dashboardSidebarOrderSchema: DashboardSidebarOrderSchema =
  dashboardSidebarOrderSchemaDefinition;
export type DashboardSidebarOrder = z.infer<typeof dashboardSidebarOrderSchema>;

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

/** A Dashboards board (DashboardsV2): the stored row with the product it is homed in. */
const boardSchemaDefinition = z
  .object({
    ...dashboardSchema.shape,
    homeProduct: dashboardHomeProductSchema,
    /** The member whose own My dashboard this is; null or absent on every other board. */
    myDashboardOfUserId: z.string().nullish(),
  })
  .strict();
export interface BoardSchema extends Named<typeof boardSchemaDefinition> {}
export const boardSchema: BoardSchema = boardSchemaDefinition;
export type Board = z.infer<typeof boardSchema>;

/** A project as a board names it: who owns the board, or whose data it can show. */
const dashboardProjectSchemaDefinition = z
  .object({ id: projectIdSchema, name: z.string(), slug: z.string() })
  .strict();
export interface DashboardProjectSchema extends Named<typeof dashboardProjectSchemaDefinition> {}
export const dashboardProjectSchema: DashboardProjectSchema = dashboardProjectSchemaDefinition;
export type DashboardProject = z.infer<typeof dashboardProjectSchema>;

/** A Reports board in a list, with the number of cards its grid draws. */
const dashboardSummarySchemaDefinition = z
  .object({ ...dashboardSchema.shape, graphCount: z.number().int().nonnegative() })
  .strict();
export interface DashboardSummarySchema extends Named<typeof dashboardSummarySchemaDefinition> {}
export const dashboardSummarySchema: DashboardSummarySchema = dashboardSummarySchemaDefinition;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

/** A Dashboards board in a list: `graphCount` is its widgets, with the reader's star. */
const boardSummarySchemaDefinition = z
  .object({
    ...dashboardSummarySchema.shape,
    homeProduct: dashboardHomeProductSchema,
    /** The member whose own My dashboard this is; null or absent on every other board. */
    myDashboardOfUserId: z.string().nullish(),
    /** Whether the member reading the list has starred this board. */
    isStarred: z.boolean(),
    /** The project that owns an Organization board listed in another project; null at home. */
    ownerProject: dashboardProjectSchema.nullable(),
  })
  .strict();
export interface BoardSummarySchema extends Named<typeof boardSummarySchemaDefinition> {}
export const boardSummarySchema: BoardSummarySchema = boardSummarySchemaDefinition;
export type BoardSummary = z.infer<typeof boardSummarySchema>;

/**
 * A board in the organization's Dashboards library (ADR-002). `project` is the owner, named only
 * where the reader may read it; `openProject` is where the board opens, null when nowhere.
 */
const organizationBoardSchemaDefinition = z
  .object({
    id: dashboardIdSchema,
    name: dashboardNameSchema,
    description: z.string().nullable(),
    createdById: z.string().nullable(),
    scope: dashboardScopeSchema,
    homeProduct: dashboardHomeProductSchema,
    /** The member whose own My dashboard this is; null or absent on every other board. */
    myDashboardOfUserId: z.string().nullish(),
    updatedAt: z.date(),
    project: dashboardProjectSchema.nullable(),
    openProject: dashboardProjectSchema.nullable(),
    /** The author's display name; null when the board has no author or the author no name. */
    ownerName: z.string().nullable(),
  })
  .strict();
export interface OrganizationBoardSchema extends Named<typeof organizationBoardSchemaDefinition> {}
export const organizationBoardSchema: OrganizationBoardSchema = organizationBoardSchemaDefinition;
export type OrganizationBoard = z.infer<typeof organizationBoardSchema>;

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
 * The name a member's own default board is made with, the first time they open Dashboards. It
 * starts Only me and in its creator's stars, and `myDashboardOfUserId` marks it, so a rename
 * keeps it theirs (dashboards-v2.feature AC160b, AC163, AC170).
 */
export const MY_DASHBOARD_NAME = "My dashboard";

/** What the My dashboard rules read of a board. */
export type MyDashboardCandidate = Readonly<{
  name: string;
  createdById: string | null;
  myDashboardOfUserId?: string | null;
}>;

/**
 * Whether the board is the member's own My dashboard: marked theirs, or, on a row made before the
 * mark and not filled yet, made by them under the default name.
 */
export function isMyDashboardOf({
  board,
  userId,
}: {
  board: MyDashboardCandidate;
  userId: string | undefined;
}): boolean {
  if (userId === undefined) return false;
  if (board.myDashboardOfUserId !== undefined && board.myDashboardOfUserId !== null) {
    return board.myDashboardOfUserId === userId;
  }
  return board.name === MY_DASHBOARD_NAME && board.createdById === userId;
}

/**
 * The member's My dashboards among these boards, the one that counts first: those marked theirs
 * before the unmarked ones, each group in the order given.
 */
export function findMyDashboards<Board extends MyDashboardCandidate>({
  boards,
  userId,
}: {
  boards: readonly Board[];
  userId: string | undefined;
}): Board[] {
  const theirs = boards.filter((board) => isMyDashboardOf({ board, userId }));
  const isMarked = (board: Board) => board.myDashboardOfUserId === userId;
  return [...theirs.filter(isMarked), ...theirs.filter((board) => !isMarked(board))];
}

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

// -- what `/api/v1/analytics/reports` accepts ------------------------------

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

/** `/api/v1/analytics/reports/:reportId`: a Reports dashboard named for what it is there. */
const reportRestParamsSchemaDefinition = z.object({ reportId: z.string().min(1) });
export interface ReportRestParamsSchema extends Named<typeof reportRestParamsSchemaDefinition> {}
export const reportRestParamsSchema: ReportRestParamsSchema = reportRestParamsSchemaDefinition;
