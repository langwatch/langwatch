/**
 * `/api/me` — the personal developer surface a project API key reads. User serves the
 * project's identity; governance serves `/usage` at this path (its me-usage.rest.ts).
 */
import { anyAuthenticated } from "@langwatch/api/access";
import { baseResponses, defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import { meProjectResponseSchema, UserApi } from "@langwatch/user-contract";

/** Why `/project` names no route permission. */
const THE_KEY_NAMES_ITS_OWN_PROJECT =
  "Any key bound to a project, an ingestion key holding only traces:create included, reads only that project's identity (id, name, slug, isPersonal), which the door resolved from the key itself.";

export const meRest = defineRestRouter(UserApi)
  .withNamespace("me")
  .withVersion(MANAGEMENT_API_VERSION)

  .get("/project", "getApiMeProject")
  .withAccess(anyAuthenticated({ reason: THE_KEY_NAMES_ITS_OWN_PROJECT }))
  .withOutput(meProjectResponseSchema)
  .withDocs({
    description:
      "Identity of the project the calling API key belongs to: id, name, slug and whether it is a personal workspace project. Answers any API key bound to the project, an ingestion key holding only traces:create included, so a client (the CLI's identity notice, a widget, a traces link) can say which project a key targets without any further access.",
    tags: ["Me"],
    responses: { ...baseResponses },
  })
  .handle(({ app, scope }) => app.getKeyProject({ projectId: scope.id }))
  .build();
