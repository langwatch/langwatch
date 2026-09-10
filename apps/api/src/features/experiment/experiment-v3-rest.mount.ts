/**
 * The API process's `/api/experiments/*` workbench doors and their
 * `/api/evaluations/v3/*` alias. No analytics sink means `evaluation_ran` is
 * intentionally dropped; no progress store means the run doors answer 503
 * rather than unregistering.
 */
import {
  bindRestMiddleware,
  type MountableRestApp,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import type { ExperimentApp } from "@langwatch/experiment-server";
import {
  experimentV3AliasRest,
  experimentV3Rest,
  type ExperimentV3AliasApi,
  type ExperimentV3RestApi,
  type ExperimentV3RunLoop,
  experimentWorkbenchCredential,
  experimentWorkbenchCaller,
  experimentWorkbenchRunRest,
} from "@langwatch/experiment-server";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";
import type { ApiExperimentRun } from "../../app/api-experiment-run.composition.ts";
import type { ApiHandlerManagedSessionPort } from "../../app/api-handler-managed-session.ts";

/** Everything the workbench's ten doors bind to on this process. */
export type ApiExperimentV3RestCollaborators = Readonly<{
  session: ApiHandlerManagedSessionPort;
  experiments: () => ExperimentApp;
  run: ApiExperimentRun;
  reportError?: ((error: unknown, context: Record<string, unknown>) => void) | undefined;
}>;

/** The `ExperimentV3RestApi` door, over this process's collaborators. */
function experimentV3RestApiOf(
  collaborators: ApiExperimentV3RestCollaborators,
): ExperimentV3RestApi {
  return {
    probeProjectPermission: (session, projectId, permission) =>
      collaborators.session.permitted({ session, projectId, permission }),
    experiments: collaborators.experiments,
    // The composed run loop satisfies the family's port shape exactly: it is
    // what the packaged input types were carved out of.
    run: collaborators.run satisfies ExperimentV3RunLoop,
    ...(collaborators.reportError ? { reportError: collaborators.reportError } : {}),
  };
}

/** The two workbench paths the browser session opens; every other path is the project key's. */
const SESSION_PATHS = new Set(["/api/experiments/execute", "/api/experiments/abort"]);

/**
 * Mounts `/api/experiments/*` (the project-key family and the two session
 * doors) and its `/api/evaluations/v3/*` alias. Both families are mounted
 * first, since the alias forwards into their own `fetch` by path.
 */
export function mountExperimentV3Rest(
  runtime: ApiRestRuntime,
  options: Readonly<{
    collaborators: ApiExperimentV3RestCollaborators;
    errors: RestErrorHandler;
  }>,
): readonly [MountableRestApp, MountableRestApp, MountableRestApp] {
  const app = experimentV3RestApiOf(options.collaborators);

  const canonical = runtime.mount(experimentV3Rest.router(), () => app, {
    onError: options.errors,
    facts: [
      bindRestMiddleware(experimentWorkbenchCredential, (context) => {
        const credential = runtime.projectCredentialOf(context.req.raw);
        if (credential.type === "legacyProjectKey") return { kind: "legacyProjectKey" };

        return {
          kind: "apiKey",
          userId: credential.userId,
          ...(credential.isLangySessionKey === void 0
            ? {}
            : { isLangySessionKey: credential.isLangySessionKey }),
        };
      }),
    ],
  });
  const session = runtime.mount(experimentWorkbenchRunRest.router(), () => app, {
    onError: options.errors,
    facts: [
      bindRestMiddleware(experimentWorkbenchCaller, (context) => ({
        userId: runtime.browserCallerOf(context.req.raw).userId ?? null,
      })),
    ],
  });
  const alias = runtime.mount(
    experimentV3AliasRest.router(),
    (): ExperimentV3AliasApi => ({
      forward: async (request) =>
        SESSION_PATHS.has(new URL(request.url).pathname)
          ? session.fetch(request)
          : canonical.fetch(request),
    }),
    { onError: options.errors },
  );

  return [canonical, session, alias];
}
