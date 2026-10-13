/**
 * `/api/me` — the personal developer surface a project API key reads. User serves the
 * project's identity; governance serves `/usage` at this path (its me-usage.rest.ts).
 */
import { baseResponses, defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import { meProjectResponseSchema, UserApi } from "@langwatch/user-contract";

export const meRest = defineRestRouter(UserApi)
  .withNamespace("me")
  .withVersion(MANAGEMENT_API_VERSION)

  .get("/project", "getApiMeProject")
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
