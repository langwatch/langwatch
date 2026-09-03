/**
 * This process's composition of the dataset editor's row generator
 * (`@langwatch/dataset-server`).
 *
 * The prompt, the three row tools and the UI-message stream are the feature's.
 * What is this process's is the browser session the door names a person with
 * and the model the generation runs on — and both decide whether the family is
 * mounted at all.
 */
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import { createDatasetGenerateRestApp } from "@langwatch/dataset-server";

import type { ApiAuthoringModelResolver } from "../../app/api-authoring-model.composition";
import type {
  ApiHandlerManagedSessionPort,
  HandlerManagedSession,
} from "../../app/api-handler-managed-session";

/**
 * `/api/dataset/generate`, bound to one process.
 *
 * ORDERING: the path is literal and must be registered BEFORE the packaged
 * dataset family's `/:slugOrId`, which would otherwise swallow `generate` as
 * a dataset name. This process composes no packaged dataset family today; the
 * array order keeps the rule true when it does.
 */
export function mountDatasetGenerateRest(options: {
  security: AppRestSecurity;
  session: ApiHandlerManagedSessionPort;
  resolveModel: ApiAuthoringModelResolver;
}): MountableRestApp {
  const { security, session, resolveModel } = options;
  return createDatasetGenerateRestApp<HandlerManagedSession>({
    security,
    ports: {
      resolveSession: (request) => session.resolve(request),
      probeProjectPermission: (person, projectId, permission) =>
        session.permitted({ session: person, projectId, permission }),
      resolveModel,
    },
  });
}
