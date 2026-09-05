/**
 * The scope a request arrived on, read off a handler's own context — typed
 * once, instead of `c.get("project") as ProjectIdentity` in every family.
 */

// Written by hand, that read was an assertion per family, and a reason for a
// feature package to depend on `hono` for the `Context` type its signature
// needed.
import type { ErrorHandler } from "hono";

import type { AppRestOrganizationVariables, AppRestProjectVariables } from "./variables.js";
import type { EndpointVariables, ServiceContext } from "./types.js";

/**
 * A context that can answer for one variable. Structural rather than a whole
 * `ServiceContext`: Hono's context is INVARIANT in its variables map, so a
 * parameter naming one map would refuse every family with its own provider.
 */
type ScopeReader<TKey extends string, TValue> = {
  get(key: TKey): TValue | undefined;
};

/** A handler context on a family whose door resolved a project. */
export type ProjectScopedContext<
  TVariables extends Record<string, unknown> = EndpointVariables,
  TApp = unknown,
> = ServiceContext<TVariables & Partial<AppRestProjectVariables>, TApp>;

/** A handler context on a family whose door resolved an organization. */
export type OrganizationScopedContext<
  TVariables extends Record<string, unknown> = EndpointVariables,
  TApp = unknown,
> = ServiceContext<TVariables & Partial<AppRestOrganizationVariables>, TApp>;

/**
 * The project this request is scoped to. It throws rather than answering
 * `undefined` when the door did not run: a handler reading a missing project
 * would query with a blank id, which widens the read rather than refusing.
 */
export function projectOf(
  context: ScopeReader<"project", AppRestProjectVariables["project"]>,
): AppRestProjectVariables["project"] {
  const project = context.get("project");
  if (!project) {
    throw new Error(
      "No project on the request context: this route is not on a project-scoped family, " +
        'or its authentication was declared away with withAuth("none")',
    );
  }
  return project;
}

/** The organization this request is scoped to. @see projectOf */
export function organizationOf(
  context: ScopeReader<"organization", AppRestOrganizationVariables["organization"]>,
): AppRestOrganizationVariables["organization"] {
  const organization = context.get("organization");
  if (!organization) {
    throw new Error(
      "No organization on the request context: this route is not on an organization-scoped " +
        'family, or its authentication was declared away with withAuth("none")',
    );
  }
  return organization;
}

/**
 * A family's own `onError`, and the boundary one is handed — Hono's shape,
 * re-exported so a feature package needs no dependency on Hono to name the
 * argument its `errorHandler` takes.
 */
export type RestErrorHandler = ErrorHandler;
