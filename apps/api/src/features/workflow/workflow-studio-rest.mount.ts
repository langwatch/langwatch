/**
 * Binds the Studio editor's two literal REST doors to this process's REST
 * runtime, over the SAME `WorkflowApi` the `workflow.*` tRPC namespace reads.
 *
 * Both routes resolve their own browser session as a declared fact and answer
 * their own 401/403 in the editor's own sentences, so the declaration's every
 * route is public and no API credential opens this door.
 */
import { bindRestMiddleware, type MountableRestApp } from "@langwatch/api/rest";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { workflowStudioRest, workflowStudioSession } from "@langwatch/workflow-server";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";
import type { ApiHandlerManagedSessionPort } from "../../app/api-handler-managed-session.ts";

/** Everything the two literal Studio doors bind to on this process. */
export type ApiWorkflowStudioRestCollaborators = Readonly<{
  workflows: () => WorkflowApi;
  session: ApiHandlerManagedSessionPort;
}>;

/** Mounts `/api/workflows/{code-completion,post_event}`. */
export function mountWorkflowStudioRest(
  runtime: ApiRestRuntime,
  options: ApiWorkflowStudioRestCollaborators,
): MountableRestApp {
  return runtime.mount(workflowStudioRest.router(), options.workflows, {
    facts: [
      bindRestMiddleware(workflowStudioSession, (context) =>
        options.session.resolve(context.req.raw),
      ),
    ],
  });
}
