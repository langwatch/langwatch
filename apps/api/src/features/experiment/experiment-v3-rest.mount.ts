/**
 * This process's composition of the experiment workbench's ten REST doors
 * (`@langwatch/experiment-server`).
 *
 * The family owns the wire; what lives here is the graph it dispatches
 * through, and every part of that graph is one this process ALREADY composed
 * for its tRPC half: the same `ExperimentApp` the `experiments.*` namespace
 * answers from, the same run loop the workbench's own procedures start, the
 * same browser session the other authoring doors resolve a person with, and
 * the same project-credential port every handler-managed family reads a key
 * through.
 *
 * ## Two absences, both named rather than filled
 *
 * **The product-analytics signal.** The route this replaces fired an
 * `evaluation_ran` capture and a feature-adoption nurturing event when a run
 * finished. This process composes no product-analytics sink, so the port is
 * left out and the signal is not sent. Refusing instead would cost somebody
 * the run they just watched succeed — the same judgment the prompt library's
 * nurturing trail already records.
 *
 * **The run loop, where a deployment composed none.** `ApiExperimentRun`
 * already answers `ports: null` / `progress: null` on a process with no
 * progress store or no public origin, and the family turns that into a 503
 * naming the capability on the four run doors while the four workbench doors
 * keep answering. Mounting nothing would take the saved setup's read and write
 * away from a deployment that can serve them perfectly well.
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

import type { ApiExperimentRun } from "../../app/api-experiment-run.composition";
import type {
  ApiHandlerManagedSessionPort,
  HandlerManagedSession,
} from "../../app/api-handler-managed-session";
import type { HandlerManagedCredential } from "../../app/api-handler-managed-credential";

/**
 * The project credential these doors read.
 *
 * The RICHER of the process's two credential shapes, not the narrowed one the
 * other handler-managed families take: a run addressed by slug answers with a
 * link built from the PROJECT's slug, and a workbench write is attributed to
 * the person the key was minted for. Both come off the resolved token.
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
 * `/api/experiments/*` and its `/api/evaluations/v3/*` alias, bound to one
 * process.
 *
 * TWO apps, returned in the order they must be registered: the alias
 * re-dispatches INTO the canonical family, so it can neither be mounted
 * without it nor before it.
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

  return [canonical, createExperimentV3LegacyAliasRestApp({ canonical })];
}
