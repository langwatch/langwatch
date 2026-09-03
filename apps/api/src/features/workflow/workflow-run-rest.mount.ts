/**
 * This process's composition of the three URLs a synchronous studio run is
 * started from (`@langwatch/workflow-server`).
 *
 * The run executes on the SAME `WorkflowService` the workbench's own cells
 * dispatch through — taken off the composed run loop rather than built here,
 * so a workflow run started over REST and one started as an experiment cell
 * resolve the same graph, the same models and the same published version.
 *
 * The credential is the process's one project-key port, so the 400/401/403
 * bodies an SDK already parses are the ones every handler-managed family on
 * this process publishes.
 */
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { createWorkflowRunRestApp } from "@langwatch/workflow-server";
import type { WorkflowService } from "@langwatch/workflow-contract";

import type { HandlerManagedCredential } from "../../app/api-handler-managed-credential";

/** Everything the three run URLs bind to on this process. */
export type ApiWorkflowRunRestCollaborators = Readonly<{
  credential: (input: {
    request: Request;
    permission: AuthzPermission;
  }) => Promise<HandlerManagedCredential>;
  workflows: () => Pick<WorkflowService, "run">;
}>;

/**
 * `/api/workflows/…/run` and `/api/optimization/…`, bound to one process.
 *
 * ORDERING: two of the three paths are parameterised under `/api/workflows`,
 * so this family must be registered AFTER the Studio's literal
 * `code-completion` and `post_event` doors — which the process feature array
 * gives it.
 */
export function mountWorkflowRunRest(options: {
  security: AppRestSecurity;
  collaborators: ApiWorkflowRunRestCollaborators;
}): MountableRestApp {
  const { security, collaborators } = options;
  return createWorkflowRunRestApp({
    security,
    ports: {
      authenticateCredential: (input) => collaborators.credential(input),
      workflows: collaborators.workflows,
    },
  });
}
