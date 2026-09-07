/**
 * This process's composition of the prompt playground's execution door
 * (`POST /api/prompt-playground/<version>/prompt.execute`).
 *
 * The family — the wire, the refusal order and the server-sent-event framing —
 * lives in `@langwatch/prompt-server`. What lives here is what it dispatches
 * through and this process owns: the browser session it resolves a person
 * with, the origin the app is served from, the demo project execution is
 * refused on, the workflow application that resolves a run's environment and
 * datasets, and the studio dispatch that opens the run.
 *
 * The SESSION decides whether the door is mounted at all — it is
 * `credential: "session"`, and a process with no browser-session transport can
 * name nobody. So do the WORKFLOW application and the studio dispatch: a run
 * with neither is a door onto nothing.
 */
import type { AppRestSecurity, MountableRestApp } from "@langwatch/api/rest";
import { isAllowedAuthOrigin } from "@langwatch/auth-server";
import { createPromptExecuteRestApp } from "@langwatch/prompt-server";
import { generateOtelTraceId } from "@langwatch/trace-contract";
import type { WorkflowApp } from "@langwatch/workflow-server";

import type {
  ApiHandlerManagedSessionPort,
  HandlerManagedSession,
} from "../../app/api-handler-managed-session.ts";

/** One studio run, opened and streamed, as this process dispatches it. */
export type ApiPromptExecuteDispatch = Parameters<
  typeof createPromptExecuteRestApp<HandlerManagedSession>
>[0]["ports"]["postEvent"];

/** Everything `/api/prompt-playground/*` binds to here. */
export type ApiPromptExecuteRestCollaborators = Readonly<{
  session: ApiHandlerManagedSessionPort;
  /** The origin the app is served from, for the state-changing origin gate. */
  browserSessionBaseUrl: string | undefined;
  /** The shared demo project, where execution is refused. */
  demoProjectId: string | undefined;
  /** The workflow application the tRPC `workflow.*` namespace answers from. */
  workflows: () => Pick<WorkflowApp, "prepareStudioEvent">;
  /** One studio run, opened and streamed. */
  postEvent: ApiPromptExecuteDispatch;
  /** Where an unexpected failure is reported. */
  reportError?: ((error: unknown, context: { projectId: string }) => void) | undefined;
}>;

/**
 * `/api/prompt-playground/<version>/prompt.execute`, bound to one process.
 *
 * ORDERING: the path is literal and the namespace is this door's alone, so it
 * neither shadows nor is shadowed by any other family.
 */
export function mountPromptExecuteRest(options: {
  security: AppRestSecurity;
  collaborators: ApiPromptExecuteRestCollaborators;
}): MountableRestApp {
  const { security, collaborators } = options;

  return createPromptExecuteRestApp<HandlerManagedSession>({
    security,
    ports: {
      // No configured base url leaves nothing to compare an origin against, and
      // the gate fails closed on one it cannot parse.
      isAllowedOrigin: (input) =>
        isAllowedAuthOrigin({ ...input, baseUrl: collaborators.browserSessionBaseUrl ?? "" }),
      resolveSession: (request) => collaborators.session.resolve(request),
      probeProjectPermission: (session, projectId, permission) =>
        collaborators.session.permitted({ session, projectId, permission }),
      isDemoProject: (projectId) => projectId === collaborators.demoProjectId,
      prepareStudioEvent: (input) => collaborators.workflows().prepareStudioEvent(input),
      postEvent: collaborators.postEvent,
      newTraceId: () => generateOtelTraceId(),
      ...(collaborators.reportError ? { reportError: collaborators.reportError } : {}),
    },
  });
}
