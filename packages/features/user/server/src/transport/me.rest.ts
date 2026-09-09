/**
 * `/api/me` — the personal developer surface a project API key reads: the
 * spend, usage and model breakdown the /me dashboard renders, and the identity
 * of the project behind the key. Whether a key may answer for a PERSON is the
 * application's question, because the credential's class is half of it.
 */
import {
  baseResponses,
  defineRestMiddleware,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
} from "@langwatch/api/rest";
import {
  mePersonalCredentialSchema,
  meProjectResponseSchema,
  meUsageQuerySchema,
  meUsageResponseSchema,
  UserApi,
} from "@langwatch/user-contract";

/** The credential the mounting process resolved, whole rather than in pieces. */
export const mePersonalCredential = defineRestMiddleware(
  "mePersonalCredential",
  mePersonalCredentialSchema,
);

export const meRest = defineRestRouter(UserApi)
  .withNamespace("me")
  .withVersion(MANAGEMENT_API_VERSION)

  .get("/usage", "getMyUsage")
  .withQuery(meUsageQuerySchema)
  .withPermission("project:view")
  .withMiddleware(mePersonalCredential)
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

  .get("/project", "getMyProject")
  .withPermission("project:view")
  .withOutput(meProjectResponseSchema)
  .withDocs({
    description:
      "Identity of the project the calling API key belongs to: id, name, slug and whether it is a personal workspace project. Lets a client (the CLI's identity notice, a widget) say which project a key targets without any further access.",
    tags: ["Me"],
    responses: { ...baseResponses },
  })
  .handle(({ app, scope }) => app.getKeyProject({ projectId: scope.id }))
  .build();
