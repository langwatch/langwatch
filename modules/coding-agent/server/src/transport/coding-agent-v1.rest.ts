/**
 * `GET /api/v1/coding-agent/pull-request-usage`: what one pull request cost
 * across every project the CALLER may read. Organization-wide, so an
 * organization key alone opens it and no project is named anywhere.
 */
import { anyAuthenticated } from "@langwatch/api/access";
import {
  baseResponses,
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import { CodingAgentApi } from "@langwatch/coding-agent-contract";
import { z } from "zod";

import {
  pullRequestUsageQuerySchema,
  pullRequestUsageResponseSchema,
} from "../rules/pull-request-usage-wire.rules.ts";

/**
 * What the organization door resolved: the key, the member it acts as — null
 * for a service key — and the stable actor string the audits are written with.
 */
export const codingAgentV1RestCaller = defineRestMiddleware(
  "codingAgentV1RestCaller",
  z.object({
    apiKeyId: z.string(),
    userId: z.string().nullable(),
    actorId: z.string(),
  }),
);

const AUTHORIZED_BY_THE_CALLER_CUT =
  "authentication is the organization key; the authorization is the caller's per-project cut, " +
  "resolved by the application with the key as the principal, because no single " +
  "organization-scope permission describes the projects one credential may read";

export const codingAgentV1Rest = defineRestRouter(CodingAgentApi)
  .withNamespace("coding-agent-v1")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("organizationKey")
  // At exactly the address it has always answered, which names its own
  // generation and so has no twin to declare.
  .withAddressing("literal", { v1Twin: false })

  .get("/api/v1/coding-agent/pull-request-usage", "getOrganizationCodingAgentPullRequestUsage")
  .withQuery(pullRequestUsageQuerySchema)
  .withAccess(anyAuthenticated({ reason: AUTHORIZED_BY_THE_CALLER_CUT }))
  .withOutput(pullRequestUsageResponseSchema)
  .withMiddleware(codingAgentV1RestCaller)
  .withDocs({
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
    responses: baseResponses,
  })
  .handle(async ({ app, input, scope }, caller) => {
    const host = input.host ?? new URL(app.githubWebBase()).hostname;

    // The credential is the principal, not its holder: a deliberately narrowed
    // key must read with its own scope rather than the full reach of whoever
    // created it, and a service key — which acts as nobody — reads with its
    // bindings alone.
    const usage = await app.getOrganizationPullRequestUsage(
      {
        organizationId: scope.id,
        repositoryHost: host,
        repositoryFullName: input.repository,
        prNumber: input.pullRequest,
      },
      { kind: "apiKey", apiKeyId: caller.apiKeyId, userId: caller.userId },
    );

    // This answer names people, so who read it stays attributable. Awaited
    // before the answer leaves, so a read is never served unrecorded.
    await app.recordPullRequestUsageRead({
      readerUserId: caller.actorId,
      organizationId: scope.id,
      repositoryHost: host,
      repositoryFullName: input.repository,
      prNumber: input.pullRequest,
      contributingProjectCount: new Set(usage.rows.map((row) => row.projectId)).size,
    });

    return usage;
  })
  .build();
