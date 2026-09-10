/**
 * `/api/playground` — the model playground's streaming proxy, over
 * `runtime.mount`. The door resolves nobody itself: the project travels in a
 * header, so the signed-in person and their standing on it arrive as one
 * bound fact, and the route answers its own 401 and 403 from it.
 *
 * Bound to the SAME gateway every other model dispatch on this process
 * resolves through and to the SAME execution proxy address, so the playground
 * can never answer from a provider row the rest of the product cannot see.
 */
import { bindRestMiddleware, type MountableRestApp } from "@langwatch/api/rest";
import {
  playgroundRest,
  playgroundRestCaller,
  playgroundRestExecutionProxy,
  playgroundRestModel,
  playgroundRestProject,
  playgroundRestSystemPrompt,
} from "@langwatch/model-provider-server";

import type { ApiPlaygroundRestCollaborators } from "../../app/api-authoring-rest.composition.ts";
import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** `/api/playground`, bound to one process. */
export function mountPlaygroundRest(
  runtime: ApiRestRuntime,
  collaborators: ApiPlaygroundRestCollaborators,
): MountableRestApp {
  const { session, modelProviders, executionProxyBaseUrl } = collaborators;

  return runtime.mount(playgroundRest.router(), modelProviders, {
    facts: [
      bindRestMiddleware(playgroundRestCaller, async (context) => {
        const person = await session.resolve(context.req.raw);
        if (!person) return { kind: "anonymous" as const };

        const projectId = context.req.raw.headers.get("x-project-id");
        const permitted = projectId
          ? await session.permitted({ session: person, projectId, permission: "playground:view" })
          : false;

        return { kind: "signedIn" as const, userId: person.user.id, permitted };
      }),
      bindRestMiddleware(playgroundRestProject, (context) =>
        context.req.raw.headers.get("x-project-id"),
      ),
      bindRestMiddleware(playgroundRestModel, (context) => context.req.raw.headers.get("x-model")),
      bindRestMiddleware(playgroundRestSystemPrompt, (context) =>
        context.req.raw.headers.get("x-system-prompt"),
      ),
      bindRestMiddleware(playgroundRestExecutionProxy, () => executionProxyBaseUrl),
    ],
  });
}
