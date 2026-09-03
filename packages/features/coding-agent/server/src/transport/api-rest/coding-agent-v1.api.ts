/**
 * The coding-agent v1 REST family: `GET /api/v1/coding-agent/pull-request-usage`.
 *
 * The pull-request usage rollup answers an ORGANIZATION-wide question — what
 * one pull request cost across every project the CALLER may read — so this
 * door authenticates at the organization: an organization API key alone, with
 * no project header and no project named anywhere. Both key kinds are served.
 * A user-bound key reads with its own bindings intersected with its holder's,
 * and an organization SERVICE key — created for no user, the credential a
 * continuous-integration job holds — reads with its bindings alone.
 *
 * The project-scoped `/api/coding-agent/pull-request-usage` answers the same
 * question but recovers a calling person through their personal workspace's
 * project id, an indirection an organization key already makes unnecessary. It
 * stays, and both doors answer the same wire ({@link pull-request-usage.wire}).
 *
 * `GET /sessions/:sessionId/events` is deliberately NOT here: it reads one
 * project's data and is correctly addressed by a project credential, so it
 * does not belong on an organization door.
 *
 * WHY NO `requires(...)` ON THE ROUTE. The authorization IS the caller's
 * per-project cut, resolved in the handler, because no single
 * organization-scope permission describes "the projects this member may read":
 * a member whose only grant is their own personal workspace must still get
 * their own rollup. The cut is the same one the in-app surfaces resolve,
 * through the same application method.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { anyAuthenticated } from "@langwatch/api";
import {
  type AppRestOrganizationVariables,
  type AppRestSecurity,
  baseResponses,
  managementActor,
  type SecuredApp,
} from "@langwatch/api/rest";
import { ValidationError } from "@langwatch/handled-error";
import { describeRoute, resolver } from "hono-openapi";

import type { CodingAgentApp } from "#app/coding-agent.app";
import type { CodingAgentRestAuditPort } from "./coding-agent.api";
import {
  pullRequestUsageParameters,
  pullRequestUsageQuerySchema,
  pullRequestUsageResponseSchema,
} from "./pull-request-usage.wire";

/** REST for the organization-keyed coding-agent reads, `/api/v1/coding-agent`. */
export function createCodingAgentV1RestApp(options: {
  security: AppRestSecurity;
  /**
   * Resolved per request, as reading it off the Hono context used to be:
   * mounting a family must not force its services to be constructed, which is
   * what lets the OpenAPI spec generator build this app with none.
   */
  app: () => CodingAgentApp;
  /** Records who read an answer that names people. */
  audit: () => CodingAgentRestAuditPort;
}): SecuredApp<{ Variables: AppRestOrganizationVariables }> {
  const { security, app, audit } = options;

  const secured = security.createOrgApp({ basePath: "/api/v1/coding-agent" });

  secured
    // Authentication is the organization key; the AUTHORIZATION is the
    // caller's per-project cut, resolved in the handler with the key as the
    // principal. No `requires(...)` fits: no single organization-scope
    // permission describes "the projects this credential may read", and a
    // member whose only grant is their own personal workspace must still get
    // their own rollup.
    .access(anyAuthenticated())
    .get(
      "/pull-request-usage",
      describeRoute({
        summary: "Get pull request coding agent usage",
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
          "project id is sent anywhere. A key created for you reads with your " +
          "own access; an organization service key, such as one a continuous " +
          "integration job holds, reads with the access its bindings grant. " +
          "Rows appear only for projects the key may view, and cost only for " +
          "those it may price.",
        parameters: [...pullRequestUsageParameters],
        responses: {
          ...baseResponses,
          200: {
            description: "The pull request's usage rollup",
            content: {
              "application/json": {
                schema: resolver(pullRequestUsageResponseSchema),
              },
            },
          },
        },
      }),
      async (c) => {
        const organization = c.get("organization");
        const application = app();

        const query = pullRequestUsageQuerySchema.safeParse({
          repository: c.req.query("repository"),
          pullRequest: c.req.query("pullRequest"),
          host: c.req.query("host") ?? new URL(application.githubWebBase()).hostname,
        });
        if (!query.success) throw ValidationError.fromZodError(query.error);

        // The credential is the principal, not its holder: a deliberately
        // narrowed key must read with its own scope rather than the full reach
        // of whoever created it, and a service key — which acts as nobody —
        // reads with its bindings alone.
        const usage = await application.getOrganizationPullRequestUsage(
          {
            organizationId: organization.id,
            repositoryHost: query.data.host,
            repositoryFullName: query.data.repository,
            prNumber: query.data.pullRequest,
          },
          {
            kind: "apiKey",
            apiKeyId: c.get("apiKeyId"),
            userId: c.get("apiKeyUserId"),
          },
        );

        // This answer names people, so who read it stays attributable. Awaited
        // before the answer leaves, so a read is never served unrecorded.
        // Never the contributors themselves: how many projects fed the rollup
        // says how wide the read reached without copying the names into a
        // second store that outlives it. A service key acts as nobody, so it
        // is recorded as `apikey:<id>` — the same stable actor string the
        // management audits use.
        await audit().auditLog({
          userId: managementActor(c),
          organizationId: organization.id,
          action: "codingAgents.pullRequestUsage",
          targetKind: "pullRequest",
          targetId: `${query.data.host}/${query.data.repository}#${query.data.pullRequest}`,
          args: {
            repository: query.data.repository,
            host: query.data.host,
            pullRequest: query.data.pullRequest,
            contributingProjectCount: new Set(usage.rows.map((row) => row.projectId)).size,
          },
        });

        return c.json(usage);
      },
    );

  return secured;
}
