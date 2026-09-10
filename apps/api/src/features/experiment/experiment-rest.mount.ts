/** Binds the project-keyed experiment list, read and create declaration. */
import {
  bindRestMiddleware,
  credentialPrincipalOfToken,
  type MountableRestApp,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import type { ExperimentApi } from "@langwatch/experiment-contract";
import { experimentRest, experimentRestCredential } from "@langwatch/experiment-server";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** Mounts the three project-keyed `/api/experiments` routes. */
export function mountExperimentRest(
  runtime: ApiRestRuntime,
  options: Readonly<{
    experiments: () => ExperimentApi;
    errors: RestErrorHandler;
  }>,
): MountableRestApp {
  return runtime.mount(experimentRest.router(), options.experiments, {
    onError: options.errors,
    facts: [
      bindRestMiddleware(experimentRestCredential, (context) =>
        credentialPrincipalOfToken(runtime.projectCredentialOf(context.req.raw)),
      ),
    ],
  });
}
