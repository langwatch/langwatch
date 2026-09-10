/** Binds the DSPy optimizer step log to the process's project credential. */
import {
  bindRestMiddleware,
  type MountableRestApp,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import { dspyStepsCaller, experimentDspyStepsRest } from "@langwatch/experiment-server";

import type { HandlerManagedCredential } from "../../app/api-handler-managed-credential.ts";
import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

export type ApiDspyStepsCredentialPort = (input: {
  request: Request;
  permission: AuthzPermission;
}) => Promise<HandlerManagedCredential>;

class ApiDspyStepsCredentialRefusal extends Error {
  constructor(
    readonly status: Extract<HandlerManagedCredential, { ok: false }>["status"],
    readonly body: object,
  ) {
    super("DSPy step credential refused");
  }
}

/** Mounts `POST /api/dspy/log_steps` behind the experiment management ceiling. */
export function mountExperimentDspyStepsRest(
  runtime: ApiRestRuntime,
  options: Readonly<{
    experiments: () => ExperimentApi;
    credential: ApiDspyStepsCredentialPort;
    errors: RestErrorHandler;
  }>,
): MountableRestApp {
  const onError: RestErrorHandler = (error, context) => {
    if (error instanceof ApiDspyStepsCredentialRefusal) {
      return context.json(error.body, error.status);
    }

    return options.errors(error, context);
  };

  return runtime.mount(experimentDspyStepsRest.router(), options.experiments, {
    onError,
    facts: [
      bindRestMiddleware(dspyStepsCaller, async (context) => {
        const credential = await options.credential({
          request: context.req.raw,
          permission: "experiments:manage",
        });
        if (!credential.ok) {
          throw new ApiDspyStepsCredentialRefusal(credential.status, credential.body);
        }

        return { projectId: credential.project.id };
      }),
    ],
  });
}
