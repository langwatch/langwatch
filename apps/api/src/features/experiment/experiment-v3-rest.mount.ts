/**
 * The API process's `/api/experiments/*` workbench doors and their
 * `/api/evaluations/v3/*` alias. No analytics sink means `evaluation_ran` is
 * intentionally dropped; no progress store means the run doors answer 503
 * rather than unregistering.
 */
import {
  credentialPrincipalOfToken,
  type MountableRestApp,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { ExperimentApp } from "@langwatch/experiment-server";
import {
  experimentV3AliasRest,
  experimentV3Rest,
  type ExperimentV3AliasApi,
  type ExperimentV3RestApi,
  type ExperimentV3RestCredential,
  type ExperimentV3RunLoop,
} from "@langwatch/experiment-server";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";
import type { ApiExperimentRun } from "../../app/api-experiment-run.composition.ts";
import type { ApiHandlerManagedSessionPort } from "../../app/api-handler-managed-session.ts";
import type { HandlerManagedCredential } from "../../app/api-handler-managed-credential.ts";

/**
 * The richer of the process's two credential shapes (not the narrowed one
 * other handler-managed families take): a slug-addressed run needs the
 * project's slug, and a workbench write needs the minting person.
 */
export type ApiExperimentV3CredentialPort = (input: {
  request: Request;
  permission: AuthzPermission;
}) => Promise<HandlerManagedCredential>;

/** Everything the workbench's ten doors bind to on this process. */
export type ApiExperimentV3RestCollaborators = Readonly<{
  session: ApiHandlerManagedSessionPort;
  credential: ApiExperimentV3CredentialPort;
  experiments: () => ExperimentApp;
  run: ApiExperimentRun;
  reportError?: ((error: unknown, context: Record<string, unknown>) => void) | undefined;
}>;

/**
 * The process's resolved credential as the workbench family takes it: the
 * credential's CLASS and the member it acts as, rather than the whole token,
 * so a write's attribution is read from one typed principal everywhere.
 */
function experimentV3CredentialOf(
  credential: HandlerManagedCredential,
): ExperimentV3RestCredential {
  if (!credential.ok) return credential;
  return {
    ok: true,
    project: credential.project,
    credential: credential.resolved ? credentialPrincipalOfToken(credential.resolved) : null,
    markUsed: credential.markUsed,
  };
}

/** The `ExperimentV3RestApi` door, over this process's collaborators. */
function experimentV3RestApiOf(collaborators: ApiExperimentV3RestCollaborators): ExperimentV3RestApi {
  return {
    resolveSession: (request) => collaborators.session.resolve(request),
    probeProjectPermission: (session, projectId, permission) =>
      collaborators.session.permitted({ session, projectId, permission }),
    authenticateCredential: async (input) =>
      experimentV3CredentialOf(await collaborators.credential(input)),
    experiments: collaborators.experiments,
    // The composed run loop satisfies the family's port shape exactly: it is
    // what the packaged input types were carved out of.
    run: collaborators.run satisfies ExperimentV3RunLoop,
    ...(collaborators.reportError ? { reportError: collaborators.reportError } : {}),
  };
}

/**
 * Mounts `/api/experiments/*` and its `/api/evaluations/v3/*` alias. The
 * canonical family is mounted first, since the alias forwards into its own
 * `fetch`.
 */
export function mountExperimentV3Rest(
  runtime: ApiRestRuntime,
  options: Readonly<{
    collaborators: ApiExperimentV3RestCollaborators;
    errors: RestErrorHandler;
  }>,
): readonly [MountableRestApp, MountableRestApp] {
  const app = experimentV3RestApiOf(options.collaborators);

  const canonical = runtime.mount(experimentV3Rest.router(), () => app, { onError: options.errors });
  const alias = runtime.mount(
    experimentV3AliasRest.router(),
    (): ExperimentV3AliasApi => ({ forward: (request) => canonical.fetch(request) }),
    { onError: options.errors },
  );

  return [canonical, alias];
}
