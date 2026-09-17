/**
 * Schema for a persisted dashboard widget's `CustomGraph.graph` column: one React/TSX file
 * (`code`) plus named LangWatchQL statements (`queries`) called via `LW.query(name, params)`
 * (reserved dashboard-context params: ADR-130). Versioned like `workbenchChartDefinition.ts`.
 */

import { z } from "zod";

import { MAX_LWQL_LENGTH } from "./langwatch-ql-limits.ts";

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
/** A widget name is a label, not a document — the persisted column is short. */
const MAX_WIDGET_NAME_LENGTH = 200;

/**
 * Every author-declared parameter name starting with this prefix is rejected — the prefix,
 * not a fixed name list, is what "reserved" means (ADR-130). Host-supplied dashboard context
 * lives in this namespace; author-declared params never may.
 */
export const DASHBOARD_CONTEXT_PARAMETER_PREFIX = "dashboard_context_";

/**
 * Property names that must never become a parameter: assigning to one on a plain object
 * mutates the prototype chain instead of adding an own key, silently losing the bound
 * value (and, for `__proto__`, opening a prototype-pollution vector).
 */
const FORBIDDEN_PARAMETER_NAMES = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/**
 * Bound automatically by the executor from the page's window/granularity, never an
 * author-declared parameter (ADR-130). Exported as objects, not just names, so the
 * client-side parameters editor can list them as built-in rows without server imports.
 */
export const RESERVED_PARAMETERS = [
  {
    name: "dashboard_context_period_start",
    type: "DateTime",
    description:
      "Start of the dashboard's selected time range — bound automatically.",
  },
  {
    name: "dashboard_context_period_end",
    type: "DateTime",
    description: "End of the selected time range (exclusive).",
  },
  {
    name: "dashboard_context_granularity_seconds",
    type: "UInt32",
    description: "Suggested bucket size in seconds for the selected range.",
  },
] as const;

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
        (name) => !name.startsWith(DASHBOARD_CONTEXT_PARAMETER_PREFIX),
        `The "${DASHBOARD_CONTEXT_PARAMETER_PREFIX}" prefix is reserved for the dashboard context — pick a different parameter name`,
      )
      // `QUERY_NAME_PATTERN` admits `__proto__`, `constructor` and
      // `prototype`, but binding one is a footgun: `validated[name] = value`
      // on a plain object would mutate the prototype (or a builtin) instead of
      // adding an own key, so the value is silently dropped. Refuse the name
      // at the schema rather than lose the value at bind time.
      .refine((name) => !FORBIDDEN_PARAMETER_NAMES.has(name), {
        error: (payload) =>
          `"${String(payload.value)}" is a reserved JavaScript property name — pick a different parameter name`,
      }),
    type: queryParameterTypeSchema,
    /**
     * Fills the value a `LW.query` call omits for this parameter — also the Run button's
     * source of a value when testing standalone; a parameter with no default must always
     * be passed. Stored typed, not as a string, so a mistyped default is a schema violation.
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

/**
 * The bounded request-shape pieces every write surface (tRPC router, REST routes) shares,
 * so neither accepts what the other would reject, and neither persists an unbounded blob
 * only caught after the write (DoS via oversized `code`/`queries` — CWE-770).
 */
export const dashboardWidgetNameSchema = z
  .string()
  .min(1)
  .max(MAX_WIDGET_NAME_LENGTH);
export const dashboardWidgetCodeSchema = z.string().min(1).max(MAX_CODE_LENGTH);
export const dashboardWidgetQueriesSchema = z
  .array(dashboardWidgetQuerySchema)
  .max(MAX_QUERIES_PER_WIDGET);

export const dashboardWidgetDefinitionSchema = z.object({
  version: z.literal(DASHBOARD_WIDGET_DEFINITION_VERSION),
  code: dashboardWidgetCodeSchema,
  queries: dashboardWidgetQueriesSchema,
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
 * What a rejected `LW.query(name, params)` carries back to the frame. Shaped to assign
 * structurally into the bridge's own `ChartQueryError` (`.../bridgeProtocol.ts`) without
 * this server module importing that client one.
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
 * The validation gate `LW.query(name, params)` runs before `analytics.lwql.query` — every
 * key must be a declared parameter of the right type, and a typo fails here, not inside
 * ClickHouse. Framework-free and synchronous so live dispatch and the "Run" button agree.
 */
export function validateDashboardWidgetQueryParams({
  query,
  params,
}: {
  query: Pick<DashboardWidgetQuery, "parameters">;
  params: Readonly<Record<string, unknown>>;
}): DashboardWidgetQueryParamValidation {
  const declared = query.parameters ?? [];
  const declaredNames = new Set(declared.map((p) => p.name));

  const undeclared = Object.keys(params).filter(
    (key) => !declaredNames.has(key),
  );
  if (undeclared.length > 0) {
    const [first] = undeclared;
    if (first?.startsWith(DASHBOARD_CONTEXT_PARAMETER_PREFIX)) {
      return {
        ok: false,
        error: {
          code: "dashboard_widget_query_reserved_param",
          title: "Reserved query parameter",
          message: `"${first}" is bound automatically from the page's own dashboard context (window and granularity) — a query never sets it, and LW.query must not pass it either.`,
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

  // Null-prototype so a declared name that slipped past the schema still can
  // never reach `Object.prototype`; the assign below adds only own keys.
  const validated: Record<string, DashboardWidgetQueryParamValue> =
    Object.create(null);
  for (const declaration of declared) {
    const resolved = resolveDeclaredParam({
      declaration,
      value: params[declaration.name],
    });
    if (!resolved.ok) return resolved;
    validated[declaration.name] = resolved.value;
  }

  return { ok: true, params: validated };
}

/** One declared parameter's value: from `params`, its default, or a rejection. */
function resolveDeclaredParam({
  declaration,
  value,
}: {
  declaration: DashboardWidgetQueryParameterDeclaration;
  value: unknown;
}):
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
  // Right JS type, but the value still has to satisfy the same bounds a
  // *declared default* does (string length, finite number) — the endpoint
  // binds it verbatim, so an over-long string or a non-finite number is
  // refused here rather than handed to ClickHouse.
  const bounded = queryParameterValueSchema.safeParse(value);
  if (!bounded.success) {
    return {
      ok: false,
      error: {
        code: "dashboard_widget_query_invalid_param",
        title: "Invalid query parameter value",
        message: `"${declaration.name}" is out of the allowed range for a ${declaration.type}.`,
      },
    };
  }
  return { ok: true, value: bounded.data };
}
