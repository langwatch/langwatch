/**
 * The `/api/prompts` family over the runtime a process mounts it on, with the
 * two facts the process resolves bound to fixed answers.
 */
import {
  bindRestMiddleware,
  createRestRuntime,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import type { PromptApi } from "@langwatch/prompt-contract";
import { HTTPException } from "hono/http-exception";

import { promptRest, promptRestCredential, promptRestFacts } from "../prompt.rest.ts";

export const PROMPT_TEST_PROJECT = "project_authorized";
export const PROMPT_TEST_ORGANIZATION = "org_1";

/**
 * The process's own boundary renderer, reduced to what these tests read back.
 * Hono's own refusal wins; a handled error keeps its status and code; anything
 * else degrades to the generic unknown.
 */
const renderRefusal: RestErrorHandler = (error, c) => {
  if (error instanceof HTTPException) return error.getResponse();

  if (HandledError.isHandled(error)) {
    const serialized = error.serialize();

    return c.json({ error: serialized.code, message: error.message }, serialized.httpStatus as 400);
  }

  return c.json({ error: "Internal Server Error" }, 500);
};

/** Mounts the family over one application, as a project key reaches it. */
export function mountPromptRest(options: {
  app: PromptApi;
  projectId?: string;
  organizationId?: string;
}) {
  const projectId = options.projectId ?? PROMPT_TEST_PROJECT;
  const organizationId = options.organizationId ?? PROMPT_TEST_ORGANIZATION;

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "api_key", id: "api_key_1" },
        scope: { tier: "project", id: projectId } as const,
      }),
    },
  });

  const hono = runtime.mount(promptRest.router(), {
    app: () => options.app,
    credential: "projectKey",
    onError: renderRefusal,
    facts: [
      bindRestMiddleware(promptRestFacts, () => ({
        organizationId,
        promptsUrl: "https://app.test/authorized/prompts",
      })),
      bindRestMiddleware(promptRestCredential, () => ({
        type: "legacyProjectKey" as const,
        projectId,
      })),
    ],
  });

  return {
    request: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}
