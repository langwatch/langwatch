/**
 * Binds the evaluator REST declaration to this process's project-key door.
 *
 * The declaration names one fact on the routes that need it — what the project
 * is called, which is what an evaluator's platform URL is built from — and this
 * file is where it is answered, once per request.
 */
import {
  bindRestMiddleware,
  createRestRuntime,
  projectRestFacts,
  type MountableRestApp,
  type PlatformUrlBuilder,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import type { ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { createEvaluatorRest } from "@langwatch/evaluator-server";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ApiHandlerManagedCredentialPort } from "../../app-rest/app-rest.process-features.ts";

/** The door's own refusal body, kept as the credential chain wrote it. */
class EvaluatorCredentialRefusal extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly body: object,
  ) {
    super("evaluator request refused");
    this.name = "EvaluatorCredentialRefusal";
  }
}

/** The person a write is recorded against; nothing for a project or service key. */
function viewerUserIdOf(resolved: ResolvedApiKeyCredential): string | null {
  return resolved.type === "apiKey" ? resolved.userId : null;
}

/** Who acted, when nobody is behind the credential: the key, or its project. */
function actorIdOf(resolved: ResolvedApiKeyCredential): string {
  if (resolved.type !== "apiKey") return resolved.project.id;

  return resolved.userId ?? resolved.apiKeyId;
}

/** Mounts `/api/evaluators` with the refusal bodies this family has answered. */
export function mountEvaluatorRest(options: {
  evaluators: () => EvaluatorApi;
  credential: ApiHandlerManagedCredentialPort;
  platformUrl: PlatformUrlBuilder;
  /** The process's own error envelope, which every refusal falls through to. */
  errors: RestErrorHandler;
}): MountableRestApp {
  const credentials = new WeakMap<Request, ResolvedApiKeyCredential>();
  const runtime = createRestRuntime({
    identity: {
      authenticate: async ({ request, permission }) => {
        const credential = await options.credential({ request, permission });
        if (!credential.ok) {
          throw new EvaluatorCredentialRefusal(credential.status, credential.body);
        }
        credentials.set(request, credential.resolved);

        return {
          actor: null,
          scope: { tier: "project", id: credential.project.id } as const,
          markUsed: credential.markUsed,
        };
      },
    },
  });

  return runtime.mount(createEvaluatorRest(options.platformUrl).router(), {
    app: options.evaluators,
    credential: "projectKey",
    onError: credentialRefusal(options.errors),
    facts: [
      bindRestMiddleware(projectRestFacts, (context) => {
        const resolved = credentials.get(context.req.raw);
        if (!resolved) throw new Error("Evaluator REST resolved no credential for this request");

        return {
          projectSlug: resolved.project.slug,
          viewerUserId: viewerUserIdOf(resolved),
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
    if (error instanceof EvaluatorCredentialRefusal) return context.json(error.body, error.status);

    return boundary(error, context);
  };
