/**
 * The wire shape of one submitted LangWatchQL statement, shared by the
 * workbench's tRPC mutation and `POST /api/v1/query`. The ceiling and the
 * accepted steps ARE the published contract, so both doors read one copy.
 */
import { authzPermissionSchema, type RestKeyCredentialPrincipal } from "@langwatch/authorization";
import { defineMiddlewareContext, type Named } from "@langwatch/module";
import { z } from "zod";

import {
  isLangWatchQLSurfaceParameter,
  LWQL_ACCEPTED_GRANULARITY_STEPS,
} from "./analytics.lwql-time-window.ts";
import {
  lwqlTimeWindowSchema,
  traceSourcesSchema,
  type LangWatchQLProtections,
} from "./analytics.lwql.ts";
import {
  LWQL_MAX_MEMBER_PROJECTS,
  LWQL_MAX_NAMED_PROJECTS,
  MAX_LWQL_LENGTH,
} from "./langwatch-ql-limits.ts";

/**
 * The caller-specific content gates the catalog understands, as a value a
 * transport can carry across a boundary. Annotated with the type it stands for,
 * so the two stop compiling together rather than drifting apart.
 */
export const langWatchQLProtectionsSchema: z.ZodType<LangWatchQLProtections> = z
  .object({
    canSeeCosts: z.boolean().nullable().optional(),
    canSeeCapturedInput: z.boolean().nullable().optional(),
    canSeeCapturedOutput: z.boolean().nullable().optional(),
    catalogue: z.object({ permissions: z.array(authzPermissionSchema).readonly() }).strict(),
  })
  .strict();

/**
 * What this credential may see of its project's content. A fact rather than
 * an operation: the answer is the KEY's own cut, shared by every REST family
 * that layers LangWatchQL content gates over its own routes.
 */
export const langWatchQLCallerProtections = defineMiddlewareContext(
  "langWatchQLCallerProtections",
  langWatchQLProtectionsSchema,
);

/**
 * Who an API key is, as the key door resolved it: a legacy project key IS its own project; any
 * other key reaches the projects of its organization it holds `analytics:view` on. Annotated with
 * the framework's type, so the two stop compiling together rather than drifting apart.
 */
export type LangWatchQLKeyReach = RestKeyCredentialPrincipal;
export const langWatchQLKeyReachSchema: z.ZodType<LangWatchQLKeyReach> = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("project"), projectId: z.string().min(1) }).strict(),
    z
      .object({
        kind: z.literal("apiKey"),
        apiKeyId: z.string().min(1),
        userId: z.string().min(1).nullable(),
        organizationId: z.string().min(1),
        resolvedProject: z
          .object({ id: z.string().min(1), teamId: z.string().min(1) })
          .strict()
          .optional(),
        isLangySessionKey: z.boolean().optional(),
      })
      .strict(),
  ],
);

/** The key the query door authenticated, resolved by the process rather than the handler. */
export const langWatchQLKeyReach = defineMiddlewareContext(
  "langWatchQLKeyReach",
  langWatchQLKeyReachSchema,
);

export { MAX_LWQL_LENGTH };

/**
 * A bound parameter's value. Scalars only: a parameter is a *value*, and
 * anything structured would be one whose shape a declared ClickHouse type
 * cannot describe.
 */
const lwqlParameterValueSchemaDefinition = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export interface LwqlParameterValueSchema extends Named<
  typeof lwqlParameterValueSchemaDefinition
> {}
export const lwqlParameterValueSchema: LwqlParameterValueSchema =
  lwqlParameterValueSchemaDefinition;

/**
 * The caller's parameters. A reserved name's value is not shape-checked: the refusal naming the
 * request field to send instead (`lwql_reserved_parameter_supplied`) answers, not a shape error.
 */
const lwqlParametersSchemaDefinition = z.preprocess(
  (parameters) =>
    typeof parameters === "object" && parameters !== null && !Array.isArray(parameters)
      ? Object.fromEntries(
          Object.entries(parameters).map(([name, value]) => [
            name,
            isLangWatchQLSurfaceParameter(name) ? null : value,
          ]),
        )
      : parameters,
  z.record(z.string(), lwqlParameterValueSchema),
);

/**
 * The datapoint step a caller may request, as every door accepts it — one of
 * the {@link LWQL_ACCEPTED_GRANULARITY_STEPS}, nothing else, so an off-list
 * value is a schema rejection rather than the service's backstop.
 */
const lwqlGranularityStepSchemaDefinition = z.union(
  LWQL_ACCEPTED_GRANULARITY_STEPS.map((step) => z.literal(step)) as [
    z.ZodLiteral<(typeof LWQL_ACCEPTED_GRANULARITY_STEPS)[number]>,
    z.ZodLiteral<(typeof LWQL_ACCEPTED_GRANULARITY_STEPS)[number]>,
    ...z.ZodLiteral<(typeof LWQL_ACCEPTED_GRANULARITY_STEPS)[number]>[],
  ],
);
export interface LwqlGranularityStepSchema extends Named<
  typeof lwqlGranularityStepSchemaDefinition
> {}
export const lwqlGranularityStepSchema: LwqlGranularityStepSchema =
  lwqlGranularityStepSchemaDefinition;

/** One submitted statement, as both doors accept it. */
const lwqlStatementSchemaDefinition = z.object({
  // Deliberately not `.trim()`: the statement the database runs must be the one
  // that was submitted, and normalising it here — however harmlessly — is the
  // first step of the rewriting this API promises never to do.
  sql: z.string().min(1).max(MAX_LWQL_LENGTH),
  parameters: lwqlParametersSchemaDefinition.optional(),
  /**
   * The period this caller is reporting over. Honoured on both doors, because
   * the same saved chart is readable from both and a statement that follows the
   * period must not have two meanings depending on which surface asked.
   */
  timeWindow: lwqlTimeWindowSchema.optional(),
  /**
   * The datapoint step for a statement that declares
   * `{period_granularity_seconds:UInt32}`, in seconds.
   */
  granularitySeconds: lwqlGranularityStepSchema.optional(),
});
export interface LwqlStatementSchema extends Named<typeof lwqlStatementSchemaDefinition> {}
export const lwqlStatementSchema: LwqlStatementSchema = lwqlStatementSchemaDefinition;

export type LangWatchQLStatementRequest = z.infer<typeof lwqlStatementSchema>;

/** A list of project ids a run names: at least one, at most the capability ceiling. */
const lwqlProjectsSchemaDefinition = z
  .array(z.string().min(1))
  .min(1, "projects must hold at least one id")
  .max(LWQL_MAX_NAMED_PROJECTS, `projects holds at most ${LWQL_MAX_NAMED_PROJECTS} ids`);
export interface LwqlProjectsSchema extends Named<typeof lwqlProjectsSchemaDefinition> {}
export const lwqlProjectsSchema: LwqlProjectsSchema = lwqlProjectsSchemaDefinition;

/** The same list for a signed-in member, at most {@link LWQL_MAX_MEMBER_PROJECTS} ids. */
const lwqlMemberProjectsSchemaDefinition = z
  .array(z.string().min(1), 'projects holds project ids; "all" is not stored in a widget')
  .min(1, "projects must hold at least one id")
  .max(LWQL_MAX_MEMBER_PROJECTS, `projects holds at most ${LWQL_MAX_MEMBER_PROJECTS} ids`);
export interface LwqlMemberProjectsSchema extends Named<
  typeof lwqlMemberProjectsSchemaDefinition
> {}
export const lwqlMemberProjectsSchema: LwqlMemberProjectsSchema =
  lwqlMemberProjectsSchemaDefinition;

/**
 * A union hides why its list branch refused ("projects holds at most 100 ids"); this gives that
 * reason back, so naming too many projects reads the same with or without "all" as a choice.
 */
function listRefusalOr(issue: {
  code?: string;
  errors?: readonly (readonly { message: string }[])[];
}) {
  if (issue.code !== "invalid_union") return undefined;

  return issue.errors?.[1]?.[0]?.message ?? 'projects must be "all" or a list of project ids';
}

/** The word that asks for every project the caller can read, sent as the string, not in a list. */
export const LWQL_ALL_PROJECTS = "all";

/** A run's list never holds the word: it asks for every project alone, in any case. */
const ALL_STANDS_ALONE = '"all" stands alone; send it by itself, or list project ids';
const holdsNoAllWord = (ids: readonly string[]) =>
  !ids.some((id) => id.trim().toLowerCase() === LWQL_ALL_PROJECTS);

/** What a run's `projects` holds for a key: the ids to read, or "all" of those it can read. */
const lwqlProjectsRequestSchemaDefinition = z.union(
  [
    z.literal(LWQL_ALL_PROJECTS),
    lwqlProjectsSchemaDefinition.refine(holdsNoAllWord, { message: ALL_STANDS_ALONE }),
  ],
  { error: listRefusalOr },
);
export interface LwqlProjectsRequestSchema extends Named<
  typeof lwqlProjectsRequestSchemaDefinition
> {}
export const lwqlProjectsRequestSchema: LwqlProjectsRequestSchema =
  lwqlProjectsRequestSchemaDefinition;

/** The same for a signed-in member, whose list holds at most {@link LWQL_MAX_MEMBER_PROJECTS}. */
const lwqlMemberProjectsRequestSchemaDefinition = z.union(
  [
    z.literal(LWQL_ALL_PROJECTS),
    lwqlMemberProjectsSchemaDefinition.refine(holdsNoAllWord, { message: ALL_STANDS_ALONE }),
  ],
  { error: listRefusalOr },
);
export interface LwqlMemberProjectsRequestSchema extends Named<
  typeof lwqlMemberProjectsRequestSchemaDefinition
> {}
export const lwqlMemberProjectsRequestSchema: LwqlMemberProjectsRequestSchema =
  lwqlMemberProjectsRequestSchemaDefinition;

/**
 * `POST /api/v1/query`'s body: a statement, optionally narrowed to one project the key reads.
 * The workbench runs inside one project already, so only the key door accepts `projectId`.
 */
const lwqlKeyStatementSchemaDefinition = z.object({
  ...lwqlStatementSchema.shape,
  projectId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Reads this one project, which the key must hold analytics:view on. Send projectId or projects, not both.",
    ),
  projects: lwqlProjectsRequestSchema
    .optional()
    .describe(
      'The projects to read, each one the key holds analytics:view on, or the string "all" for every project the key can read. A key that reaches several projects must name them or send "all"; a key that reads one project defaults to it. When the statement declares {dashboard_context_projects:Array(String)}, params.dashboard_context_projects lists what was read.',
    ),
  sources: traceSourcesSchema
    .optional()
    .describe(
      "The trace origins {dashboard_context_sources:Array(String)} is bound to; application when absent. The placeholder does not filter by itself: the statement keeps its rows with a predicate such as WHERE Source IN {dashboard_context_sources:Array(String)}. A statement that never uses the placeholder counts every origin.",
    ),
});
export interface LwqlKeyStatementSchema extends Named<typeof lwqlKeyStatementSchemaDefinition> {}
export const lwqlKeyStatementSchema: LwqlKeyStatementSchema = lwqlKeyStatementSchemaDefinition;

export type LangWatchQLKeyStatementRequest = z.infer<typeof lwqlKeyStatementSchema>;
