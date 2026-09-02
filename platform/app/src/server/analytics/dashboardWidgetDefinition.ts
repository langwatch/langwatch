/**
 * What a persisted dashboard widget's `CustomGraph.graph`
 * column actually stores.
 *
 * One React/TSX file (`code`) plus the named LangWatchQL statements it may
 * run (`queries`) — the file's own `LW.query(name, params)` calls reference a
 * query by `name`. `parameters` on a query is a *declaration*, not bound
 * values: the names and JS types the query accepts, so the parent can check
 * a frame's `params` argument against it before ever forwarding anything to
 * `analytics.lwql.query` as a real bind parameter. The reserved
 * `{period_start}`/`{period_end}`/`{period_granularity_seconds}` placeholders
 * are supplied by the executor regardless of what a query declares here —
 * they are the page window, not an author-declared parameter.
 *
 * Same reasoning as `saved-workbench-charts/workbenchChartDefinition.ts` for
 * being versioned: a `Json` column promises nothing about its contents, so a
 * row is read only through this schema, and a shape written by a
 * disagreeing build is refused by name instead of half-understood.
 *
 * Both the dashboard-widgets router and the client (`CustomChartPlayground.tsx`,
 * which parses `row.graph` with this same schema) import from here, so the
 * two sides cannot drift. Safe for the client to import: this module pulls in
 * nothing but `zod` and a constant, never Prisma or any server-only code.
 */

import { z } from "zod";

import { MAX_LWQL_LENGTH } from "./lwql/sqlText";

/** The version this build writes, and the only one it reads. */
export const DASHBOARD_WIDGET_DEFINITION_VERSION = 1;

/** A widget file rarely needs more than a couple of named queries. */
const MAX_QUERIES_PER_WIDGET = 8;
/** A query name is referenced from author code as `LW.query("name", ...)`. */
const MAX_QUERY_NAME_LENGTH = 64;
const QUERY_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_PARAMETERS_PER_QUERY = 32;
const MAX_PARAMETER_VALUE_LENGTH = 4_000;
/** Generous ceiling for a widget's source file — this is authored code, not data. */
const MAX_CODE_LENGTH = 200_000;

/**
 * Bound automatically by the executor from the page's window/granularity —
 * never an author-declared parameter. A query names one of these the same way
 * the `lwql-charts` skill's SQL does; declaring a parameter under one of
 * these names would silently never receive the value a caller passes, since
 * the executor's own binding always wins.
 *
 * Exported (not just the name set below) so the client-side parameters editor
 * can list these as built-in rows without hand-duplicating the names, types,
 * or ClickHouse binding, and without importing anything server-only — this
 * module is already safe for the client (zod + constants only).
 */
export const RESERVED_PARAMETERS = [
  {
    name: "period_start",
    type: "DateTime",
    description:
      "Start of the dashboard's selected time range — bound automatically.",
  },
  {
    name: "period_end",
    type: "DateTime",
    description: "End of the selected time range (exclusive).",
  },
  {
    name: "period_granularity_seconds",
    type: "UInt32",
    description:
      "Suggested bucket size in seconds for the selected range.",
  },
] as const;

const RESERVED_PARAMETER_NAMES = new Set(
  RESERVED_PARAMETERS.map((p) => p.name),
);

/**
 * The JS types a bound parameter's value may take. Scalars only, matching
 * `analytics.lwql.query`'s own `parameterValueSchema` — a declaration is only
 * useful if it describes something the query endpoint can actually bind.
 */
const queryParameterTypeSchema = z.enum(["string", "number", "boolean"]);
const queryParameterValueSchema = z.union([
  z.string().max(MAX_PARAMETER_VALUE_LENGTH),
  z.number().finite(),
  z.boolean(),
]);

const queryParameterDeclarationSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(MAX_QUERY_NAME_LENGTH)
      .regex(QUERY_NAME_PATTERN)
      .refine(
        (name) => !RESERVED_PARAMETER_NAMES.has(name),
        "Reserved for the page window — pick a different parameter name",
      ),
    type: queryParameterTypeSchema,
    /**
     * Fills the value a `LW.query` call omits for this parameter — the Run
     * button's own source of a value when testing a query standalone, and a
     * required parameter with no default is one the caller must always pass.
     * Stored typed rather than as a string so a stray unit test of a default
     * against a mistyped declaration is a schema violation, not a runtime one.
     */
    default: queryParameterValueSchema.optional(),
  })
  .superRefine((declaration, ctx) => {
    if (declaration.default === undefined) return;
    if (typeof declaration.default !== declaration.type) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["default"],
        message: `default must be a ${declaration.type} to match this parameter's declared type`,
      });
    }
  });

export const dashboardWidgetQuerySchema = z.object({
  name: z
    .string()
    .min(1)
    .max(MAX_QUERY_NAME_LENGTH)
    .regex(
      QUERY_NAME_PATTERN,
      "Query name must look like an identifier (letters, digits, underscore; not starting with a digit)",
    ),
  sql: z.string().min(1).max(MAX_LWQL_LENGTH),
  parameters: z
    .array(queryParameterDeclarationSchema)
    .max(MAX_PARAMETERS_PER_QUERY)
    .optional(),
});

export const dashboardWidgetDefinitionSchema = z.object({
  version: z.literal(DASHBOARD_WIDGET_DEFINITION_VERSION),
  code: z.string().min(1).max(MAX_CODE_LENGTH),
  queries: z.array(dashboardWidgetQuerySchema).max(MAX_QUERIES_PER_WIDGET),
});

export type DashboardWidgetQueryParameterDeclaration = z.infer<
  typeof queryParameterDeclarationSchema
>;
export type DashboardWidgetQuery = z.infer<typeof dashboardWidgetQuerySchema>;
export type DashboardWidgetDefinition = z.infer<
  typeof dashboardWidgetDefinitionSchema
>;

/** A bound parameter's value, as `LW.query`'s caller may supply it. */
export type DashboardWidgetQueryParamValue = string | number | boolean;

/**
 * What a rejected `LW.query(name, params)` carries back to the frame. Shaped
 * to assign structurally into the bridge's own `ChartQueryError` (defined in
 * `features/custom-chart-playground/bridge/bridgeProtocol.ts`) without this,
 * a server module, importing that client one.
 */
export interface DashboardWidgetQueryParamError {
  readonly code: string;
  readonly title: string;
  readonly message: string;
}

export type DashboardWidgetQueryParamValidation =
  | {
      readonly ok: true;
      readonly params: Readonly<Record<string, DashboardWidgetQueryParamValue>>;
    }
  | { readonly ok: false; readonly error: DashboardWidgetQueryParamError };

/**
 * The validation gate `LW.query(name, params)` runs through before anything
 * reaches `analytics.lwql.query`: every key the frame passed must be a
 * declared parameter of the right JS type, and every declared parameter with
 * no default must have been passed. Declaring zero parameters (`parameters`
 * omitted) means a call may pass no params at all — an empty object is
 * required, not merely allowed, so a typo'd key is caught immediately rather
 * than binding nothing and failing later inside ClickHouse.
 *
 * Framework-free and synchronous on purpose: this same function backs both
 * the live `LW.query` dispatch and the Queries tab's standalone "Run" button,
 * so a query can never validate differently in one path than the other.
 */
export function validateDashboardWidgetQueryParams(
  query: Pick<DashboardWidgetQuery, "parameters">,
  params: Readonly<Record<string, unknown>>,
): DashboardWidgetQueryParamValidation {
  const declared = query.parameters ?? [];
  const declaredNames = new Set(declared.map((p) => p.name));

  const undeclared = Object.keys(params).filter(
    (key) => !declaredNames.has(key),
  );
  if (undeclared.length > 0) {
    const [first] = undeclared;
    if (first && RESERVED_PARAMETER_NAMES.has(first)) {
      return {
        ok: false,
        error: {
          code: "dashboard_widget_query_reserved_param",
          title: "Reserved query parameter",
          message: `"${first}" is bound automatically from the page's own window and granularity — a query never sets it, and LW.query must not pass it either.`,
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "dashboard_widget_query_undeclared_param",
        title: "Unknown query parameter",
        message: `This query does not declare a parameter named "${first}". Declared: ${
          declared.length > 0
            ? declared.map((p) => p.name).join(", ")
            : "(none)"
        }.`,
      },
    };
  }

  const validated: Record<string, DashboardWidgetQueryParamValue> = {};
  for (const declaration of declared) {
    const resolved = resolveDeclaredParam(
      declaration,
      params[declaration.name],
    );
    if (!resolved.ok) return resolved;
    validated[declaration.name] = resolved.value;
  }

  return { ok: true, params: validated };
}

/** One declared parameter's value: from `params`, its default, or a rejection. */
function resolveDeclaredParam(
  declaration: DashboardWidgetQueryParameterDeclaration,
  value: unknown,
):
  | { ok: true; value: DashboardWidgetQueryParamValue }
  | { ok: false; error: DashboardWidgetQueryParamError } {
  if (value === undefined) {
    if (declaration.default !== undefined) {
      return { ok: true, value: declaration.default };
    }
    return {
      ok: false,
      error: {
        code: "dashboard_widget_query_missing_param",
        title: "Missing query parameter",
        message: `"${declaration.name}" is required and has no default — pass a value for it.`,
      },
    };
  }
  if (typeof value !== declaration.type) {
    return {
      ok: false,
      error: {
        code: "dashboard_widget_query_mistyped_param",
        title: "Wrong query parameter type",
        message: `"${declaration.name}" must be a ${declaration.type}, got ${typeof value}.`,
      },
    };
  }
  return { ok: true, value };
}
