/**
 * Resolves a project to the ClickHouse that holds its data.
 *
 * The resolution rule is the one the driver-based client had, preserved
 * deliberately (ADR-104 §4 calls it out as correct and carried over verbatim):
 * a project maps to an organisation, an organisation may be pinned to a
 * private endpoint, and everyone else shares the main one. What changed is
 * where the answer goes — it produces a routing key for the one client's
 * router, rather than a second client object configured differently from the
 * first.
 *
 * The refusal in {@link organizationIdForProject} is the important line. A
 * project id that resolves to no organisation is not a cache miss to paper
 * over with the shared endpoint: on a deployment with private instances, the
 * shared endpoint is the wrong customer's server, and answering from it is a
 * cross-tenant read. It throws instead, and has since the private-instance
 * feature was introduced.
 */

import type { PrismaClient } from "@prisma/client";
import { prisma } from "~/server/db";
import type { AppClickHouseClient } from "../clickhouseClient.factory";
import { getSharedAppClickHouseClient } from "./shared";
import {
  type ClickHouseClientResolver,
  type TenantClickHouseClient,
  tenantClickHouseClient,
} from "./tenant-client";

/**
 * `projectId → organizationId`, memoised for the life of the process.
 *
 * Safe to hold forever: a project cannot move between organisations, so the
 * mapping has no invalidation event. Bounded by project count rather than by
 * request volume.
 */
export type ProjectOrganizationCache = Map<string, string>;

export function createProjectOrganizationCache(): ProjectOrganizationCache {
  return new Map();
}

/**
 * The organisation a project belongs to — the routing key, not the tenant.
 *
 * Exported because a caller that needs the *raw* package client cannot get its
 * routing key any other way. The live case is the experiment-run totals path:
 * its columns are declared `ch.uint64()`, whose codec parses a quoted string
 * into a `bigint`, so it must read positional rows straight from the package
 * client rather than through {@link tenantClickHouseClient}, whose decoder
 * turns those same cells back into `number` and would fail every totals read
 * on a Zod parse.
 *
 * Such a caller still must not route on the project id. `mappedTenantRouter`
 * resolves totally — an unrecognised key falls back to the shared endpoint
 * rather than throwing — so passing a project id where an organisation id is
 * expected does not fail loudly for a private-endpoint customer. It quietly
 * reads the wrong server and returns nothing.
 */
export async function organizationIdForProject(args: {
  prisma: PrismaClient;
  cache: ProjectOrganizationCache;
  projectId: string;
}): Promise<string> {
  const cached = args.cache.get(args.projectId);
  if (cached !== undefined) return cached;

  const project = await args.prisma.project.findUnique({
    where: { id: args.projectId },
    select: { team: { select: { organizationId: true } } },
  });

  if (!project) {
    throw new Error(
      `Cannot resolve ClickHouse client: project "${args.projectId}" not found. Refusing to fall back to shared client to prevent data leakage.`,
    );
  }

  const organizationId = project.team.organizationId;
  args.cache.set(args.projectId, organizationId);
  return organizationId;
}

/**
 * Builds the resolver every repository holds: given a project id, the
 * ClickHouse client bound to that project.
 *
 * The project id is the tenant id the SQL filters on and the client bulkheads
 * on; the organisation id is only ever a routing key. Keeping them distinct
 * matters — bulkheading by organisation would let one busy project inside an
 * organisation starve its siblings, and filtering by organisation would return
 * a sibling project's rows.
 */
export function createClickHouseClientResolver(args: {
  client: AppClickHouseClient;
  prisma: PrismaClient;
  cache?: ProjectOrganizationCache;
}): ClickHouseClientResolver {
  const cache = args.cache ?? createProjectOrganizationCache();

  return async (projectId: string) => {
    const organizationId = await organizationIdForProject({
      prisma: args.prisma,
      cache,
      projectId,
    });

    return tenantClickHouseClient({
      client: args.client.resolveClient(organizationId),
      tenantId: projectId,
    });
  };
}

/**
 * The resolver for callers whose tenant *is* an organisation — governance and
 * billing read across every project an organisation owns, so their `TenantId`
 * predicate is an organisation-scoped one and no project lookup applies.
 */
export function createOrganizationClickHouseClientResolver(
  client: AppClickHouseClient,
): ClickHouseClientResolver {
  return async (organizationId: string) =>
    tenantClickHouseClient({
      client: client.resolveClient(organizationId),
      tenantId: organizationId,
    });
}

// ---------------------------------------------------------------------------
// Ambient accessors
// ---------------------------------------------------------------------------

/**
 * The two functions below are the direct replacements for
 * `getClickHouseClientForProject` / `getClickHouseClientForOrganization`, which
 * the `ee/` services and a few routers import at module level rather than
 * receiving from the composition root.
 *
 * They exist because those callers exist, not because reaching for a client
 * ambiently is good: a service that imports its datastore cannot be tested
 * without stubbing a module, and cannot be pointed at a second deployment. The
 * honest fix is to inject a `ClickHouseClientResolver`, and these are the
 * bridge that lets the driver be removed today without also rewriting every
 * `ee/` service's constructor. Prefer injection in anything new.
 *
 * `prisma` is imported here rather than passed, for the same reason: an ambient
 * accessor has no caller to take it from.
 */

/**
 * The one process-wide `projectId → organizationId` memo.
 *
 * Shared with {@link ambientOrganizationIdForProject} so a caller that needs
 * the raw client does not keep a second copy of the same lookup.
 */
const ambientCache = createProjectOrganizationCache();

/**
 * {@link organizationIdForProject} against the process-wide memo and Prisma,
 * for ambient callers that need a routing key without holding a resolver.
 */
export function ambientOrganizationIdForProject(
  projectId: string,
): Promise<string> {
  return organizationIdForProject({ prisma, cache: ambientCache, projectId });
}

/**
 * The client for a project, or `null` when this deployment has no ClickHouse.
 *
 * `null` rather than a throw only for the no-ClickHouse case, matching what
 * these call sites already branch on (`isClickHouseEnabled()`); a project that
 * cannot be resolved still throws, because that is the cross-tenant guard.
 */
export async function clickHouseForProject(
  projectId: string,
): Promise<TenantClickHouseClient | null> {
  const app = getSharedAppClickHouseClient();
  if (!app) return null;

  const organizationId = await organizationIdForProject({
    prisma,
    cache: ambientCache,
    projectId,
  });

  return tenantClickHouseClient({
    client: app.resolveClient(organizationId),
    tenantId: projectId,
  });
}

/**
 * The client for an organisation, or `null` when this deployment has no
 * ClickHouse. No project lookup: the organisation is already the routing key
 * and the tenant.
 */
export function clickHouseForOrganization(
  organizationId: string,
): TenantClickHouseClient | null {
  const app = getSharedAppClickHouseClient();
  if (!app) return null;

  return tenantClickHouseClient({
    client: app.resolveClient(organizationId),
    tenantId: organizationId,
  });
}
