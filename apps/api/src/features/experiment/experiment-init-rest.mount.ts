/**
 * This process's composition of `POST /api/experiment/init`
 * (`@langwatch/experiment-server`).
 *
 * One route, and the reason it has a mount of its own rather than joining the
 * workbench's ten is the credential class: the workbench doors take the RICH
 * credential (a run link is built from the project's slug, a workbench write
 * is attributed to the person the key was minted for), while this one is an
 * SDK's project key and needs the project's id and slug and nothing else.
 *
 * The find-or-create service is constructed ONCE here and handed to both
 * consumers on this process — this door and the legacy evaluation family's
 * batch result log. That is the whole point of it being a service: an SDK
 * whose `experiment_slug` resolved one way through `/api/experiment/init` and
 * another way through `/api/evaluations/batch/log_results` would silently
 * write its results against a second experiment, and nothing downstream could
 * tell the two apart.
 *
 * ## The named degradation
 *
 * **The plan's experiment limit is not enforced on this process.** The route
 * this replaces caught the licence layer's `LimitExceededError` and enriched
 * its sentence with the organization's own allowance before answering 403.
 * `apps/api` composes no licence enforcement, so nothing on this path raises
 * that error and the branch is unreachable today. It is transcribed anyway,
 * matched on the handled CODE rather than the class, so the wire an SDK's
 * limit handling reads is already correct the moment enforcement composes
 * here — what it does NOT do is re-render the message from the organization's
 * allowance, which needs the licence layer's own message builder.
 */
import { bindRestMiddleware, type MountableRestApp, type RestErrorHandler } from "@langwatch/api/rest";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import {
  ExperimentFindOrCreateService,
  experimentInitCaller,
  experimentInitRest,
  type ExperimentService,
} from "@langwatch/experiment-server";

import type { HandlerManagedCredential } from "../../app/api-handler-managed-credential.ts";
import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** The project credential this door reads. */
export type ApiExperimentInitCredential = (input: {
  request: Request;
  permission: AuthzPermission;
}) => Promise<HandlerManagedCredential>;

/** Everything `POST /api/experiment/init` binds to on this process. */
export type ApiExperimentInitRestCollaborators = Readonly<{
  credential: ApiExperimentInitCredential;
  /** The SAME experiment service the `experiments.*` namespace answers from. */
  findOrCreate: ExperimentFindOrCreateService;
  reportError?: ((error: unknown, context: { projectId: string }) => void) | undefined;
}>;

/**
 * The one find-or-create rule this process resolves an SDK's slug through.
 *
 * A function rather than an inline `new` at each call site, so the two doors
 * that need it are built from the same construction and a third cannot quietly
 * appear with its own.
 */
export function composeApiExperimentFindOrCreate(
  experiments: ExperimentService,
): ExperimentFindOrCreateService {
  return ExperimentFindOrCreateService.create(experiments);
}

/**
 * A credential the process refused, carried out of the caller binding to the
 * door's own error handler, which answers the status and body the credential
 * port chose: the SDK parses that body, so no envelope may reshape it.
 */
class ApiExperimentInitRefusal extends Error {
  constructor(
    readonly status: Extract<HandlerManagedCredential, { ok: false }>["status"],
    readonly body: object,
  ) {
    super("experiment init credential refused");
  }
}

/** `POST /api/experiment/init`, bound to one process. */
export function mountExperimentInitRest(
  runtime: ApiRestRuntime,
  options: Readonly<{
    experiments: () => ExperimentApi;
    collaborators: ApiExperimentInitRestCollaborators;
    errors: RestErrorHandler;
  }>,
): MountableRestApp {
  const { collaborators } = options;
  const onError: RestErrorHandler = (error, context) => {
    if (error instanceof ApiExperimentInitRefusal) return context.json(error.body, error.status);
    return options.errors(error, context);
  };

  return runtime.mount(experimentInitRest.router(), options.experiments, {
    onError,
    facts: [
      bindRestMiddleware(experimentInitCaller, async (context) => {
        const credential = await collaborators.credential({
          request: context.req.raw,
          permission: "experiments:manage",
        });
        if (!credential.ok) throw new ApiExperimentInitRefusal(credential.status, credential.body);
        return { projectId: credential.project.id, projectSlug: credential.project.slug };
      }),
    ],
  });
}
