// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * `GET /api/me/usage`, served by governance at user's path (plan peer-cycle-cuts §4 B4 U, R10):
 * the rollup is governance's. Path, query, permission and body are main's.
 */
import {
  baseResponses,
  defineMiddlewareContext,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import {
  GovernanceRestApi,
  mePersonalCredentialSchema,
  meUsageQuerySchema,
  meUsageResponseSchema,
} from "@langwatch/enterprise-governance-contract";

/** The credential the mounting process resolved, whole rather than in pieces. */
export const mePersonalCredential = defineMiddlewareContext(
  "mePersonalCredential",
  mePersonalCredentialSchema,
);

export const meUsageRest = defineRestRouter(GovernanceRestApi)
  .withNamespace("me")
  .withVersion(MANAGEMENT_API_VERSION)

  .get("/usage", "getApiMeUsage")
  .withSharedPath({
    owner: "user",
    reason: "the personal rollup is governance's, so governance serves it at user's /api/me",
    deprecate: "move under /api/governance in the next API version",
  })
  .withQuery(meUsageQuerySchema)
  .withPermission("project:view")
  .withMiddlewareContext(mePersonalCredential)
  .withOutput(meUsageResponseSchema)
  .withDocs({
    description:
      "Personal AI usage for the current month (or an explicit window): spend, billed spend, request + token counts, per-day buckets, and per-model breakdown. Requires a personal-project API key.",
    tags: ["Me"],
    responses: { ...baseResponses },
  })
  .handle(({ app, input, scope }, credential) =>
    app.getPersonalUsage({
      projectId: scope.id,
      credential,
      ...(input.windowStartMs !== undefined && input.windowEndMs !== undefined
        ? { window: { startMs: input.windowStartMs, endMs: input.windowEndMs } }
        : {}),
    }),
  )
  .build();
