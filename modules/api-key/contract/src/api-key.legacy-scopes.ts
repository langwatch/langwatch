import { z } from "zod";

/**
 * Scope flags for a legacy project key (`Project.apiKey`), one entry per flag. A flag opens only
 * the routes that name it with `withLegacyKeyScope(...)`, for the projects its rule lists
 * (spec: modules/auth/specs/legacy-project-key-scope.feature).
 */
export const LEGACY_PROJECT_KEY_SCOPE_FLAGS = [
  "legacy_project_key_prompts_read",
  "legacy_project_key_prompts_write",
  "legacy_project_key_traces_read",
  "legacy_project_key_annotations_read",
  "legacy_project_key_scenarios",
  "legacy_project_key_evaluations",
  "legacy_project_key_experiments",
  "legacy_project_key_connected_agents",
] as const;

export const legacyProjectKeyScopeFlagSchema = z.enum(LEGACY_PROJECT_KEY_SCOPE_FLAGS);

/** The logger every legacy key line below is written to; the census reads it by this name. */
export const LEGACY_PROJECT_KEY_LOGGER_NAME = "langwatch:legacy-project-key";
/** A request no scope flag or full access covers: allowed, or refused on an enforced project. */
export const LEGACY_PROJECT_KEY_OUTSIDE_SCOPE_MESSAGE = "legacy project key outside its scopes";
/** A census line: a legacy key request beyond ingestion that was answered. */
export const LEGACY_PROJECT_KEY_CENSUS_MESSAGE = "legacy project key request";
/** One line per project, route, permission and kind per window in a process. */
export const LEGACY_PROJECT_KEY_LOG_WINDOW_MS = 60_000;

/** A legacy key request beyond ingestion, as the lines and the span record it; never the token. */
export type LegacyProjectKeyUse = Readonly<{
  projectId: string;
  organizationId: string;
  /** `METHOD /path/:param`, never the concrete URL with its ids or query. */
  route: string;
  /** The permission asked, or null on a route that only identifies the caller. */
  permission: string | null;
  /** The scope flags the route names (`withLegacyKeyScope`). */
  routeScopes: readonly string[];
}>;

/** The decision on one use: refused or allowed outside the scopes, or granted by a scope flag. */
export type LegacyProjectKeyUseDecision =
  | Readonly<{ outsideScope: true; enforced: boolean }>
  | Readonly<{ outsideScope: false; grantedBy: string }>;

/** The use and its decision as attributes on the request's span. */
export function legacyProjectKeyUseSpanAttributes(
  input: Readonly<{ use: LegacyProjectKeyUse; decision: LegacyProjectKeyUseDecision }>,
): Record<string, string | boolean | string[]> {
  const { use, decision } = input;
  const prefix = "langwatch.legacy_project_key";

  return {
    [`${prefix}.project_id`]: use.projectId,
    [`${prefix}.organization_id`]: use.organizationId,
    [`${prefix}.route`]: use.route,
    [`${prefix}.permission`]: use.permission ?? "none",
    [`${prefix}.route_scopes`]: [...use.routeScopes],
    [`${prefix}.outside_scope`]: decision.outsideScope,
    ...(decision.outsideScope
      ? { [`${prefix}.enforced`]: decision.enforced }
      : { [`${prefix}.granted_by`]: decision.grantedBy }),
  };
}

/** One log line a use writes. */
export type LegacyProjectKeyLogLine = Readonly<{
  level: "info" | "warn";
  message: string;
  fields: Readonly<Record<string, unknown>>;
}>;

/** The key a process holds a use's window under: project, route and permission. */
export function legacyProjectKeyUseWindowKey(use: LegacyProjectKeyUse): string {
  return [use.projectId, use.route, use.permission ?? "none"].join(" ");
}

/**
 * The lines a use writes once its window opens: the outside-scope line when no scope covered it,
 * and the census line whenever it was answered. `suppressed` counts the uses the window held back.
 */
export function legacyProjectKeyUseLines(
  input: Readonly<{
    use: LegacyProjectKeyUse;
    decision: LegacyProjectKeyUseDecision;
    suppressed: number;
  }>,
): readonly LegacyProjectKeyLogLine[] {
  const { use, decision, suppressed } = input;
  const fields = { ...use, routeScopes: [...use.routeScopes], suppressed };
  if (!decision.outsideScope) {
    return [
      {
        level: "info",
        message: LEGACY_PROJECT_KEY_CENSUS_MESSAGE,
        fields: { ...fields, grantedBy: decision.grantedBy, scopeFlagGranted: true },
      },
    ];
  }
  const outside: LegacyProjectKeyLogLine = {
    level: "warn",
    message: LEGACY_PROJECT_KEY_OUTSIDE_SCOPE_MESSAGE,
    fields: { ...fields, enforced: decision.enforced },
  };
  if (decision.enforced) return [outside];

  return [
    outside,
    {
      level: "info",
      message: LEGACY_PROJECT_KEY_CENSUS_MESSAGE,
      fields: { ...fields, grantedBy: "report_only", scopeFlagGranted: false },
    },
  ];
}
