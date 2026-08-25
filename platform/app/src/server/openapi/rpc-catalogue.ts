/**
 * The root RPC catalogue: every API service and the URL of that service's own
 * catalogue, two levels deep.
 *
 * Each service serves its own `rpc.discover` — mounted by `@langwatch/api`
 * itself, under every version namespace — listing the RPC operations it
 * publishes. The root does not repeat them: it answers with the fleet, so a
 * caller discovers every service in one call and any one service's operations
 * in two.
 *
 * Both levels are PROJECTIONS, not registries. The per-service catalogues are
 * derived from the services' own registrations; this index is derived from
 * the mounted route tables — a service appears here because the framework
 * actually mounted its catalogue, and a service off the framework has no
 * catalogue to point at. Neither can drift from the served surface: there is
 * nothing to write to.
 *
 * See packages/api/specs/api-discovery.feature.
 */

import { DISCOVER_NAME } from "@langwatch/api";
import type { Hono } from "hono";

/** One service, as the root catalogue reports it. */
export interface RpcServiceEntry {
  /** The service's family name, e.g. `role-bindings`. */
  name: string;
  /** The URL to POST for the service's own catalogue. */
  discover: string;
}

export interface RpcServiceIndex {
  /**
   * Where the complete description lives. The catalogues cover RPC-named
   * operations only; a caller that wants the whole surface follows this.
   */
  openapi: string;
  services: RpcServiceEntry[];
}

/** The `latest` mount of a service's catalogue, e.g. `/api/roles/latest/rpc.discover`. */
const DISCOVER_SUFFIX = `/latest/${DISCOVER_NAME}`;

/**
 * The service's discover URL, found in its mounted route table — or undefined
 * when the service is not on the framework and has no catalogue to point at.
 * Reading the mount rather than a declared name is what keeps the index
 * derived: it cannot list a service whose catalogue does not answer.
 */
function discoverMountOf(app: Hono): { name: string; discover: string } | undefined {
  const route = app.routes.find(
    (r) => r.method === "POST" && r.path.endsWith(DISCOVER_SUFFIX),
  );
  if (!route) return undefined;

  // `/api/<family>/latest/rpc.discover` — the family segment.
  const name = route.path.split("/")[2];
  if (!name) return undefined;
  return { name, discover: route.path };
}

/**
 * Projects the root catalogue out of the mounted service apps.
 *
 * @param apps - The framework-built service apps, from the composition root.
 */
export function buildRpcServiceIndex({
  apps,
  openapiUrl,
}: {
  apps: Hono[];
  openapiUrl: string;
}): RpcServiceIndex {
  const services = apps
    .map(discoverMountOf)
    .filter((entry): entry is RpcServiceEntry => entry !== undefined)
    // Sorted so the response is stable between requests: the index is derived,
    // and the apps' order is the router's, not ours.
    .sort((a, b) => a.discover.localeCompare(b.discover));

  return { openapi: openapiUrl, services };
}
