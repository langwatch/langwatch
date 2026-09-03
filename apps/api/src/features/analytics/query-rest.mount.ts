/**
 * This process's composition of the packaged query family
 * (`@langwatch/analytics-server`).
 *
 * Two endpoints under `/api/v1/query`: run a LangWatchQL statement, and
 * describe what may be queried. The routes, their gate, their wire schemas and
 * their OpenAPI declarations live in the feature package; what lives here is
 * the graph they dispatch through.
 *
 * The collaborators are the SAME ones the saved-chart family is mounted with
 * — most of all the governed-SQL runner, because two of it would let the
 * workbench refuse a statement this door can still run. That is also why both
 * doors are composed from one branch in the process feature list rather than
 * two: they cannot be switched on apart.
 *
 * @see ./langwatch-ql-rest.mount.ts — the saved-chart half of the same graph
 */
import { createQueryRestApp, type LangWatchQLRestPorts } from "@langwatch/analytics-server";
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";

/**
 * What the query door actually dispatches through.
 *
 * A subset of the saved-chart family's ports: this door has no feature flag
 * and no saved charts, so `featureFlags`, `charts`, `platformUrl` and
 * `mapSavedChartError` are none of its business.
 */
export type ApiQueryRestCollaborators = Pick<
  LangWatchQLRestPorts,
  "projects" | "langWatchQL" | "protectionsFor"
>;

/** `/api/v1/query`, bound to this process's graph. */
export function mountQueryRest(options: {
  security: AppRestSecurity;
  collaborators: ApiQueryRestCollaborators;
}): MountableRestApp {
  return createQueryRestApp({
    security: options.security,
    ports: options.collaborators as LangWatchQLRestPorts,
  });
}
