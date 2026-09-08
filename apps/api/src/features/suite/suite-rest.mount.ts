/**
 * Binds the three suite REST declarations to this process's project-key door.
 * The declarations name two facts on the routes that need them — what the
 * project is called, and which surface the request came from — and this file
 * is where both are answered, once per request.
 */
import type { Actor } from "@langwatch/actor";
import type { ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import {
  bindRestHeader,
  bindRestMiddleware,
  createRestRuntime,
  projectRestFacts,
  type MountableRestApp,
  type PlatformUrlBuilder,
  type RestCaller,
  type RestErrorHandler,
  type RestMountOptions,
} from "@langwatch/api/rest";
import type { SuiteApi } from "@langwatch/suite-contract";
import {
  createRunPlansRest,
  createSuitesAliasRest,
  createTestSuitesRest,
  suiteSurfaceFact,
  suitesAliasErrorHandler,
} from "@langwatch/suite-server";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ApiHandlerManagedCredentialPort } from "../../app-rest/app-rest.process-features.ts";

/** The door's own refusal body, kept as the credential chain wrote it. */
class SuiteCredentialRefusal extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly body: object,
  ) {
    super("suite request refused");
    this.name = "SuiteCredentialRefusal";
  }
}

/** A key bound to a person acts as that person; a project key as nobody. */
function actorOf(resolved: ResolvedApiKeyCredential): Actor | null {
  if (resolved.type !== "apiKey" || !resolved.userId) return null;

  return { type: "user", id: resolved.userId };
}

/** The person a run is recorded against; nothing for a project or service key. */
function viewerUserIdOf(resolved: ResolvedApiKeyCredential): string | null {
  return resolved.type === "apiKey" ? resolved.userId : null;
}

/**
 * Who acted, when nobody is behind the credential: the key itself, and for a
 * legacy project key the project it belongs to, which is all it identifies.
 */
function actorIdOf(resolved: ResolvedApiKeyCredential): string {
  if (resolved.type !== "apiKey") return resolved.project.id;

  return resolved.userId ?? resolved.apiKeyId;
}

/** `/api/v1/run-plans`, `/api/v1/test-suites` and the `/api/suites` alias. */
export function mountSuiteRest(options: {
  suites: () => SuiteApi;
  credential: ApiHandlerManagedCredentialPort;
  platformUrl: PlatformUrlBuilder;
  /** The process's own error envelope, which every family answers refusals in. */
  errors: RestErrorHandler;
}): readonly MountableRestApp[] {
  const credentials = new WeakMap<Request, ResolvedApiKeyCredential>();
  const runtime = createRestRuntime({
    identity: {
      authenticate: async ({ request, permission }): Promise<RestCaller> => {
        const credential = await options.credential({ request, permission });
        if (!credential.ok) throw new SuiteCredentialRefusal(credential.status, credential.body);
        credentials.set(request, credential.resolved);

        return {
          actor: actorOf(credential.resolved),
          scope: { tier: "project", id: credential.project.id },
          markUsed: credential.markUsed,
        };
      },
    },
  });

  const facts = [
    bindRestMiddleware(projectRestFacts, (context) => {
      const resolved = credentials.get(context.req.raw);
      if (!resolved) throw new Error("Suite REST resolved no credential for this request");

      return {
        projectSlug: resolved.project.slug,
        viewerUserId: viewerUserIdOf(resolved),
        actorId: actorIdOf(resolved),
      };
    }),
    bindRestHeader(suiteSurfaceFact, "x-langwatch-surface"),
  ];

  const mount = (onError: RestErrorHandler): RestMountOptions<SuiteApi> => ({
    app: options.suites,
    credential: "projectKey",
    onError: credentialRefusal(onError),
    facts,
  });

  return [
    runtime.mount(createRunPlansRest(options.platformUrl).router(), mount(options.errors)),
    runtime.mount(createTestSuitesRest(options.platformUrl).router(), mount(options.errors)),
    runtime.mount(
      createSuitesAliasRest(options.platformUrl).router(),
      mount(suitesAliasErrorHandler(options.errors)),
    ),
  ];
}

/** The credential refusal keeps the body the door wrote; everything else falls through. */
const credentialRefusal =
  (boundary: RestErrorHandler): RestErrorHandler =>
  (error, context) => {
    if (error instanceof SuiteCredentialRefusal) return context.json(error.body, error.status);

    return boundary(error, context);
  };
