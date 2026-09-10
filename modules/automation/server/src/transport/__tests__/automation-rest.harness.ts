/**
 * The automation REST families over a process's own door, as a test supplies
 * one: a project API key that resolves to `project_1`, and the facts a
 * project-scoped family reads beyond its input.
 */
import {
  bindRestMiddleware,
  createRestRuntime,
  projectRestFacts,
  type MountableRestApp,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import type { AutomationApi } from "@langwatch/automation-contract";
import { HandledError } from "@langwatch/handled-error";

import { createAutomationRest } from "../automation.rest.ts";
import { slackAutomationRest, slackAutomationRestErrors } from "../slack-trigger.rest.ts";
import { unsubscribeCallerAddress, unsubscribeRest, unsubscribeRestErrors } from "../unsubscribe.rest.ts";

/** The project every credentialed request in these suites is authenticated for. */
export const TEST_PROJECT = { id: "project_1", slug: "acme" } as const;

const platformUrl = ({ projectSlug, path }: { projectSlug: string; path: string }) =>
  `https://app.test/${projectSlug}${path}`;

/** Renders the typed refusal the way every client reads it: by code. */
const renderHandled: RestErrorHandler = (error, c) =>
  HandledError.isHandled(error)
    ? c.json({ error: error.code }, error.httpStatus as 400)
    : c.json({ error: String(error) }, 500);

function runtime() {
  return createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "user", id: "user_owner" },
        scope: { tier: "project", id: TEST_PROJECT.id },
      }),
    },
  });
}

const projectFacts = () => [
  bindRestMiddleware(projectRestFacts, () => ({
    projectSlug: TEST_PROJECT.slug,
    viewerUserId: "user_owner",
    actorId: "user_owner",
  })),
];

/** A caller over one mounted family. */
function requests(hono: MountableRestApp) {
  const send = (method: string, path: string, body?: unknown) =>
    hono.fetch(
      new Request(`http://api.test${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  return {
    get: (path: string) => send("GET", path),
    post: (path: string, body?: unknown) => send("POST", path, body ?? {}),
    patch: (path: string, body?: unknown) => send("PATCH", path, body ?? {}),
    delete: (path: string) => send("DELETE", path),
    send,
  };
}

/** `/api/triggers`, over whichever slice of the application a case names. */
export function mountAutomationRest(app: Partial<AutomationApi>) {
  return requests(
    runtime().mount(createAutomationRest(platformUrl).router(), {
      app: () => app as AutomationApi,
      credential: "project",
      onError: renderHandled,
      facts: projectFacts(),
    }),
  );
}

/** `/api/trigger/slack`, with the three bodies it has always answered. */
export function mountSlackAutomationRest(app: Partial<AutomationApi>) {
  return requests(
    runtime().mount(slackAutomationRest.router(), {
      app: () => app as AutomationApi,
      credential: "project",
      onError: slackAutomationRestErrors,
    }),
  );
}

/** `/api/unsubscribe`, whose caller presents no credential at all. */
export function mountUnsubscribeRest(
  app: Partial<AutomationApi>,
  callerAddress: string | null = "10.0.0.1",
) {
  return requests(
    runtime().mount(unsubscribeRest.router(), {
      app: () => app as AutomationApi,
      credential: "public",
      onError: unsubscribeRestErrors,
      facts: [bindRestMiddleware(unsubscribeCallerAddress, () => callerAddress)],
    }),
  );
}
