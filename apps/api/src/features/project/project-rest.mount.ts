/**
 * Binds the projects REST declaration to this process's organization door,
 * which is one tier wider than the resources: listing answers what the key
 * reaches, and each by-id route asks its permission at the project it names.
 */
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import {
  bindRestMiddleware,
  createFamilyErrorHandler,
  type MountableRestApp,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import type { ProjectManagementDirectory } from "@langwatch/project-server";
import { projectRest, projectRestCredential } from "@langwatch/project-server";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** Mounts `/api/projects` behind this process's organization credential. */
export function mountProjectRest(
  runtime: ApiRestRuntime,
  options: Readonly<{
    projects: () => ProjectManagementDirectory;
    apiKeys: () => ApiKeyApi;
    /** The process envelope this family's own mapping is layered over. */
    errors: RestErrorHandler;
  }>,
): MountableRestApp {
  return runtime.mount(
    projectRest.router(),
    () => ({ projects: options.projects, apiKeys: options.apiKeys }),
    {
      onError: createFamilyErrorHandler({
        loggerName: "langwatch:api:projects:errors",
        label: "Projects API Error",
        boundary: options.errors,
      }),
      // The credential itself, not just its holder: a listing answers what the
      // KEY reaches, and a rotation is recorded against the member it acts as.
      facts: [
        bindRestMiddleware(projectRestCredential, (context) => {
          const credential = runtime.organizationCredentialOf(context.req.raw);

          return { apiKeyId: credential.apiKeyId, userId: credential.userId };
        }),
      ],
    },
  );
}
