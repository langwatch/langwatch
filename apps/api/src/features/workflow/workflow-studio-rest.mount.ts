/**
 * This process's composition of the Studio editor's two REST doors
 * (`@langwatch/workflow-server`).
 *
 * The family — the wire, the refusal order and the server-sent-event framing —
 * lives in the feature package. What lives here is what it dispatches through
 * and this process owns: the browser session it resolves a person with, the
 * model its code completion runs on, the workflow application that resolves a
 * client event's environment, and the studio dispatch that opens the run.
 *
 * The SESSION decides whether the family is mounted at all, the same way it
 * does for the bulk run export: both doors are `credential: "session"`, and a
 * process with no browser-session transport can name nobody. The MODEL and the
 * WORKFLOW application decide too — a code completion with no model and a
 * `post_event` with no application are each half of a door.
 */
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import type { WorkflowApp } from "@langwatch/workflow-server";
import {
  WorkflowCodeCompletionAdapter,
  createWorkflowStudioRestApp,
  type WorkflowStudioRestDispatch,
} from "@langwatch/workflow-server";

import type { ApiAuthoringModelResolver } from "../../app/api-authoring-model.composition";
import type {
  ApiHandlerManagedSessionPort,
  HandlerManagedSession,
} from "../../app/api-handler-managed-session";

/** Everything `/api/workflows/{code-completion,post_event}` binds to here. */
export type ApiWorkflowStudioRestCollaborators = Readonly<{
  session: ApiHandlerManagedSessionPort;
  /** The model the editor's completions run on. */
  resolveModel: ApiAuthoringModelResolver;
  /** The workflow application the tRPC `workflow.*` namespace answers from. */
  workflows: () => Pick<WorkflowApp, "prepareStudioEvent">;
  /** One studio run, opened and streamed. */
  postEvent: WorkflowStudioRestDispatch;
  /** Where an unexpected failure is reported. */
  reportError?: ((error: unknown, context: { projectId: string }) => void) | undefined;
}>;

/**
 * `/api/workflows/{code-completion,post_event}`, bound to one process.
 *
 * ORDERING: both paths are literal, so this family neither shadows nor is
 * shadowed by the parameterised `/api/workflows/:workflowId/run` the packaged
 * workflow family claims — as long as it is registered first, which the
 * process feature array gives it.
 */
export function mountWorkflowStudioRest(options: {
  security: AppRestSecurity;
  collaborators: ApiWorkflowStudioRestCollaborators;
}): MountableRestApp {
  const { security, collaborators } = options;
  const completions = WorkflowCodeCompletionAdapter.create({
    resolveModel: collaborators.resolveModel,
  });

  return createWorkflowStudioRestApp<HandlerManagedSession>({
    security,
    ports: {
      resolveSession: (request) => collaborators.session.resolve(request),
      probeProjectPermission: (session, projectId, permission) =>
        collaborators.session.permitted({ session, projectId, permission }),
      completeCode: (input) => completions.complete(input),
      prepareStudioEvent: (input) => collaborators.workflows().prepareStudioEvent(input),
      postEvent: collaborators.postEvent,
      ...(collaborators.reportError ? { reportError: collaborators.reportError } : {}),
    },
  });
}
