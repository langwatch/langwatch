/**
 * Binds `/api/dataset` to this process's project-key door.
 *
 * EIGHT of the family's doors are not here, because the runtime cannot declare
 * their request shape yet. Each is named with what it needs:
 *
 *  - `POST /api/dataset/upload` and `POST /api/dataset/:slugOrId/upload` read a
 *    MULTIPART FILE body (`c.req.parseBody()`), and a declaration states a JSON
 *    body or none;
 *  - `POST /api/dataset/direct-upload` reads a multipart body AND resolves the
 *    caller from a browser SESSION COOKIE inside the handler, which no declared
 *    door resolves a scope for;
 *  - `PUT /api/dataset/direct-upload/staging/:uploadId` streams the RAW REQUEST
 *    BYTES into storage, and also authenticates in-handler;
 *  - `POST /api/dataset/direct-upload/:datasetId/finalize`,
 *    `POST /api/dataset/direct-upload/:datasetId/retry` and
 *    `DELETE /api/dataset/direct-upload/:datasetId` authenticate in-handler the
 *    same way;
 *  - `PATCH /api/dataset/:slugOrId/records/:recordId` answers 201 when it
 *    created the entry and 200 when it replaced one, and a declaration states
 *    ONE success status.
 *
 * `POST /api/dataset/generate` is gone with them: it answered a streamed
 * UI-message response behind a session, and neither is declarable. Its prompt
 * and its three row tools are kept in `rules/dataset-generate-tools.rules.ts`
 * so re-mounting it is one file once the runtime grows a session door and a
 * streaming answer.
 */
import {
  createRestRuntime,
  type MountableRestApp,
  type PlatformUrlBuilder,
  type RestCaller,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import { bindRestMiddleware, projectRestFacts } from "@langwatch/api/rest";
import type { Actor } from "@langwatch/actor";
import type { ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import { createDatasetErrorHandler, createDatasetRest } from "@langwatch/dataset-server";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ApiHandlerManagedCredentialPort } from "../../app-rest/app-rest.process-features.ts";

/** The door's own refusal body, kept as the credential chain wrote it. */
class DatasetCredentialRefusal extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly body: object,
  ) {
    super("dataset request refused");
    this.name = "DatasetCredentialRefusal";
  }
}

/** A key bound to a person acts as that person; a project key as nobody. */
function actorOf(resolved: ResolvedApiKeyCredential): Actor | null {
  if (resolved.type !== "apiKey" || !resolved.userId) return null;

  return { type: "user", id: resolved.userId };
}

/** Who acted, when nobody is behind the credential: the key, or the project. */
function actorIdOf(resolved: ResolvedApiKeyCredential): string {
  if (resolved.type !== "apiKey") return resolved.project.id;

  return resolved.userId ?? resolved.apiKeyId;
}

export function mountDatasetRest(options: {
  datasets: () => DatasetApi;
  credential: ApiHandlerManagedCredentialPort;
  platformUrl: PlatformUrlBuilder;
  /** The process's own error envelope, which every family answers refusals in. */
  errors: RestErrorHandler;
}): MountableRestApp {
  const credentials = new WeakMap<Request, ResolvedApiKeyCredential>();
  const runtime = createRestRuntime({
    identity: {
      authenticate: async ({ request, permission }): Promise<RestCaller> => {
        const credential = await options.credential({ request, permission });
        if (!credential.ok) throw new DatasetCredentialRefusal(credential.status, credential.body);
        credentials.set(request, credential.resolved);

        return {
          actor: actorOf(credential.resolved),
          scope: { tier: "project", id: credential.project.id },
          markUsed: credential.markUsed,
        };
      },
    },
  });

  return runtime.mount(createDatasetRest(options.platformUrl).router(), {
    app: options.datasets,
    credential: "projectKey",
    onError: credentialRefusal(createDatasetErrorHandler({ boundaryErrorHandler: options.errors })),
    facts: [
      bindRestMiddleware(projectRestFacts, (context) => {
        const resolved = credentials.get(context.req.raw);
        if (!resolved) throw new Error("Dataset REST resolved no credential for this request");

        return {
          projectSlug: resolved.project.slug,
          viewerUserId: resolved.type === "apiKey" ? resolved.userId : null,
          actorId: actorIdOf(resolved),
        };
      }),
    ],
  });
}

/** The credential refusal keeps the body the door wrote; everything else falls through. */
const credentialRefusal =
  (boundary: RestErrorHandler): RestErrorHandler =>
  (error, context) => {
    if (error instanceof DatasetCredentialRefusal) return context.json(error.body, error.status);

    return boundary(error, context);
  };
