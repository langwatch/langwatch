/**
 * Binds the monitors REST declaration to this process's project-key door.
 *
 * The declaration names one fact on the routes that need it — what the project
 * is called, for the platform link every monitor carries — and this file is
 * where it is answered, once per request.
 */
import type { Actor } from "@langwatch/actor";
import type { ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import {
  bindRestMiddleware,
  createRestRuntime,
  projectRestFacts,
  type MountableRestApp,
  type PlatformUrlBuilder,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import type { MonitorApi } from "@langwatch/monitor-contract";
import { createMonitorsRest } from "@langwatch/monitor-server";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ApiHandlerManagedCredentialPort } from "../../app-rest/app-rest.process-features.ts";

/** The door's own refusal body, kept as the credential chain wrote it. */
class MonitorCredentialRefusal extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly body: object,
  ) {
    super("monitor request refused");
    this.name = "MonitorCredentialRefusal";
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

/** Mounts `/api/monitors` on this process's project-key door. */
export function mountMonitorRest(options: {
  monitors: () => MonitorApi;
  credential: ApiHandlerManagedCredentialPort;
  platformUrl: PlatformUrlBuilder;
  /** The process's own error envelope, which every family answers refusals in. */
  errors: RestErrorHandler;
}): MountableRestApp {
  const credentials = new WeakMap<Request, ResolvedApiKeyCredential>();
  const runtime = createRestRuntime({
    identity: {
      authenticate: async ({ request, permission }) => {
        const credential = await options.credential({ request, permission });
        if (!credential.ok) throw new MonitorCredentialRefusal(credential.status, credential.body);
        credentials.set(request, credential.resolved);

        return {
          actor: actorOf(credential.resolved),
          scope: { tier: "project", id: credential.project.id },
          markUsed: credential.markUsed,
        };
      },
    },
  });

  return runtime.mount(createMonitorsRest(options.platformUrl).router(), {
    app: options.monitors,
    credential: "projectKey",
    onError: credentialRefusal(options.errors),
    facts: [
      bindRestMiddleware(projectRestFacts, (context) => {
        const resolved = credentials.get(context.req.raw);
        if (!resolved) throw new Error("Monitor REST resolved no credential for this request");

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
    if (error instanceof MonitorCredentialRefusal) return context.json(error.body, error.status);

    return boundary(error, context);
  };
