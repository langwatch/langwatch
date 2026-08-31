/**
 * The coding-agent v1 REST family: `GET /api/v1/coding-agent/pull-request-usage`.
 *
 * The pull-request usage rollup answers an ORGANIZATION-wide question — what
 * one pull request cost across every project the CALLER may read — so this
 * door authenticates at the organization: an `sk-lw` organization API key
 * alone, with no `X-Project-Id` header and no project named anywhere. Both
 * key kinds are served: a user-bound key reads with its key ceiling
 * intersected with its holder's access, and an organization SERVICE key —
 * created for no user, the credential a CI job holds — reads with its own
 * bindings alone. The legacy `/api/coding-agent/pull-request-usage` route
 * answers the same question but recovers a calling user through their
 * personal workspace's project id, an indirection the key itself already
 * makes unnecessary.
 *
 * Built on `@langwatch/api` with org-key authentication in throwing mode, the
 * way the management families are, but with no Enterprise plan gate: this read
 * ships with the product. The per-endpoint permission check is deliberately
 * absent — the authorization IS the caller's per-project cut
 * (`resolveCallerProjectScope`), resolved in the handler, because no single
 * organization-scope permission describes "the projects this member may read":
 * a member whose only grant is their own personal workspace must still get
 * their own rollup.
 *
 * `GET /sessions/:sessionId/events` stays on the legacy project family only:
 * it reads one project's data and is correctly addressed by a project
 * credential, so it does not belong on an organization door.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { auditLog } from "@ee/audit-log/auditLog";
import { createService } from "@langwatch/api";
import type { Context } from "hono";
import type { z } from "zod";
import { appContextMiddleware } from "~/app/api/middleware/app-context";
import type { Organization } from "~/generated/prisma/client";
import { managementActor } from "~/server/api/management/audit";
import {
  registerMountedRoute,
  type ServiceEndpointMeta,
} from "~/server/api/route-mount-registry";
import { familyFromBasePath, handlerManagedAuth } from "~/server/api/security";
import { V1_API_VERSION } from "~/server/api/v1/version";
import { createOrgAuthMiddleware } from "~/server/api-key/auth-middleware";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import { resolveCallerProjectScope } from "~/server/organizations/resolveCallerProjectScope";

import {
  pullRequestUsageQuerySchema,
  pullRequestUsageResponseSchema,
} from "./pull-request-usage-wire";

const BASE_PATH = "/api/v1/coding-agent";

const service = createService({
  name: "coding-agent",
  basePath: BASE_PATH,
  middleware: [appContextMiddleware],
  auth: createOrgAuthMiddleware({ prisma, refusals: "throw" }),
  onRouteMounted: (route) =>
    registerMountedRoute({
      route,
      family: familyFromBasePath(BASE_PATH),
      scope: "organization",
      surface: "Coding agent v1",
    }),
});

/**
 * Why the endpoint declares no framework-enforced permission: the handler is
 * the permission check. Rows appear only for projects where the caller holds
 * `traces:view`, and money only where they also hold `cost:view` — the same
 * cut the in-app surfaces resolve, through the same resolver.
 */
const callerScopedRead = {
  meta: {
    policy: handlerManagedAuth({
      reason:
        "authenticated by the organization-key middleware; the handler then " +
        "resolves the caller's per-project permission cut " +
        "(resolveCallerProjectScope) intersected with the key's own binding " +
        "ceiling (hasApiKeyPermission): rows appear only for projects both " +
        "the key and its holder may view, and cost only where both may " +
        "price. A service key owns no user, so its bindings alone are the " +
        "cut",
      permissions: ["traces:view", "cost:view"],
      credential: "apiKey",
    }),
  } satisfies ServiceEndpointMeta,
  noPermission: {
    reason:
      "no single organization-scope permission describes the caller's " +
      "readable projects; the handler resolves the per-project cut itself",
  },
} as const;

type UsageQuery = z.infer<typeof pullRequestUsageQuerySchema>;

const pullRequestUsageHandler = async (
  c: Context,
  { query }: { query: UsageQuery },
) => {
  const organization = c.get("organization") as Organization;
  // Null for an organization service key, which acts as nobody: the
  // credential a CI job holds, served with its own bindings as the scope.
  const callerUserId = (c.get("apiKeyUserId") as string | null) ?? null;

  // The same permission cut the in-app surfaces resolve, names included —
  // intersected with the KEY's own binding ceiling: a deliberately narrowed
  // key must read with its own scope, never its holder's full one, and a
  // service key's bindings are the whole of its scope.
  const scope = await resolveCallerProjectScope({
    userId: callerUserId,
    organizationId: organization.id,
    apiKeyCeiling: {
      apiKeyId: c.get("apiKeyId") as string,
      cuts: (query) => getApp().permissions.apiKeyProjectCuts(query),
    },
  });

  const usage =
    await getApp().codingAgents.pullRequestUsage.getPullRequestUsage({
      organizationId: organization.id,
      repositoryHost: query.host,
      repositoryFullName: query.repository,
      prNumber: query.pullRequest,
      ...scope,
    });

  // This answer names people, so who read it stays attributable. Awaited
  // before the answer leaves, so a read is never served unrecorded. Never the
  // contributors themselves: how many projects fed the rollup says how wide
  // the read reached without copying the names into a second store that
  // outlives it. A service key acts as nobody, so it is recorded as
  // `apikey:<id>` — the same stable actor string the management audits use.
  await auditLog({
    userId: managementActor(c),
    organizationId: organization.id,
    action: "codingAgents.pullRequestUsage",
    targetKind: "pullRequest",
    targetId: `${query.host}/${query.repository}#${query.pullRequest}`,
    args: {
      repository: query.repository,
      host: query.host,
      pullRequest: query.pullRequest,
      contributingProjectCount: new Set(usage.rows.map((row) => row.projectId))
        .size,
    },
  });

  return usage;
};

export const app = service
  .version(V1_API_VERSION, (v) => {
    v.get(
      "/pull-request-usage",
      {
        ...callerScopedRead,
        query: pullRequestUsageQuerySchema,
        output: pullRequestUsageResponseSchema,
        description:
          "Assistant usage for one pull request: sessions, tokens and cost, " +
          "grouped by contributor and agent, plus per-model totals, " +
          "over the pull request's whole lifetime rather than a time window. " +
          "Every row and the totals split cost three ways: the part priced per " +
          "token, the part a bundled subscription already covers, and the " +
          "list-price total of both. Per-model totals carry the list price " +
          "only. Cost is calculated from the tokens the agent reported and " +
          "LangWatch's model prices, so it estimates spend rather than " +
          "restating a provider invoice. " +
          "Authenticate with an organization API key and nothing else: no " +
          "project id is sent anywhere. A key created for you reads with " +
          "your own access; an organization service key, such as one a " +
          "continuous integration job holds, reads with the access its " +
          "bindings grant. Rows appear only for projects the key may view, " +
          "and cost only for those it may price.",
        docs: {
          summary: "Get pull request usage",
          operationId: "getPullRequestUsage",
          tags: ["Coding Agents"],
        },
      },
      pullRequestUsageHandler,
    );
  })
  .build();
