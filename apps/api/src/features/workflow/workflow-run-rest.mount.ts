/**
 * Binds the three URLs a synchronous Optimization Studio run is started from
 * to this process's REST runtime, over the SAME `WorkflowApi` the workbench's
 * own cells dispatch through and the `workflow.*` tRPC namespace reads — so a
 * run started over REST and one started as an experiment cell resolve the
 * same graph, the same models and the same published version.
 *
 * ORDERING: two of the three paths are parameterised under `/api/workflows`,
 * so this family must be mounted AFTER the Studio's literal
 * `code-completion` and `post_event` doors.
 */
import { bindRestMiddleware, type MountableRestApp } from "@langwatch/api/rest";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { workflowRunContentType, workflowRunRest } from "@langwatch/workflow-server";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

/** Everything the three run URLs bind to on this process. */
export type ApiWorkflowRunRestCollaborators = Readonly<{ workflows: () => WorkflowApi }>;

/** Mounts `/api/workflows/:id/run` and `/api/optimization/:id/run`. */
export function mountWorkflowRunRest(
  runtime: ApiRestRuntime,
  options: ApiWorkflowRunRestCollaborators,
): MountableRestApp {
  return runtime.mount(workflowRunRest.router(), options.workflows, {
    facts: [
      bindRestMiddleware(
        workflowRunContentType,
        (context) => context.req.header("content-type") ?? null,
      ),
    ],
  });
}
