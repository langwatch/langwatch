import { z } from "zod";
import { credentialPrincipalOf } from "./credential-principal.ts";
import { managementActor } from "./management-audit.ts";
import { projectOf } from "./scope-accessors.ts";
import {
  bindRestMiddleware,
  defineRestMiddleware,
  type RestTransportMiddlewareBinding,
} from "./transport-middleware.ts";
import { mountAuthenticatedProjectTransport } from "./transport-mount.ts";
import type { RestTransportDeclaration } from "./rest-router.ts";
import type { RestApiVersionedFamily } from "./security/rest-api-service.ts";

export const projectRestFacts = defineRestMiddleware(
  "project",
  z.object({
    projectSlug: z.string(),
    viewerUserId: z.string().nullable(),
    actorId: z.string(),
  }),
);

/** Connects a declared router to the project's existing credential policy. */
export function mountProjectRestRouter<Api>(options: {
  family: RestApiVersionedFamily;
  transport: RestTransportDeclaration<Api>;
  app: () => Api;
  middleware?: readonly RestTransportMiddlewareBinding[];
}): void {
  mountAuthenticatedProjectTransport({
    ...options,
    authorization: (context) => ({
      actor: null,
      scope: { tier: "project", id: projectOf(context).id },
    }),
    middleware: [
      bindRestMiddleware(projectRestFacts, (context) => {
        const project = projectOf(context);
        const principal = credentialPrincipalOf(context);

        return {
          projectSlug: project.slug,
          viewerUserId: principal.kind === "apiKey" ? principal.userId : null,
          actorId: managementActor(context),
        };
      }),
      ...(options.middleware ?? []),
    ],
  });
}
