/**
 * No analytics sink means `evaluation_ran` is intentionally dropped; no
 * progress store means the run doors answer 503 rather than unregistering.
 */
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { ExperimentApp } from "@langwatch/experiment-server";
import {
  createExperimentV3LegacyAliasRestApp,
  createExperimentV3RestApp,
  type ExperimentV3RestCredential,
  type ExperimentV3RunLoop,
} from "@langwatch/experiment-server";

import type { ApiExperimentRun } from "../../app/api-experiment-run.composition.ts";
import type {
  ApiHandlerManagedSessionPort,
  HandlerManagedSession,
} from "../../app/api-handler-managed-session.ts";
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
 * `/api/experiments/*` and its `/api/evaluations/v3/*` alias. Returned in
 * registration order: the alias re-dispatches into the canonical family, so
 * it must be mounted after it.
 */
export function mountExperimentV3Rest(options: {
  security: AppRestSecurity;
  collaborators: ApiExperimentV3RestCollaborators;
}): MountableRestApp[] {
  const { security, collaborators } = options;

  const canonical = createExperimentV3RestApp<HandlerManagedSession>({
    security,
    ports: {
      resolveSession: (request) => collaborators.session.resolve(request),
      probeProjectPermission: (session, projectId, permission) =>
        collaborators.session.permitted({ session, projectId, permission }),
      authenticateCredential: async (input) =>
        (await collaborators.credential(input)) as ExperimentV3RestCredential,
      experiments: collaborators.experiments,
      // The composed run loop satisfies the family's port shape exactly: it is
      // what the packaged input types were carved out of.
      run: collaborators.run satisfies ExperimentV3RunLoop,
      ...(collaborators.reportError ? { reportError: collaborators.reportError } : {}),
    },
  });

  return [canonical, createExperimentV3LegacyAliasRestApp({ security, canonical })];
}
