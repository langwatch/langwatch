import { canonicalErrorResponse, bindRestMiddleware, createRestRuntime } from "@langwatch/api/rest";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import { ScopedSecrets } from "@langwatch/secrets";
/**
 * The `/api/prompts` family over the runtime a process mounts it on, with the
 * two facts the process resolves bound to fixed answers.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import { PromptModule } from "#app/prompt.app";

import { defaultModelFixture } from "../../__tests__/default-model.test-fixture.ts";
import { MemoryPromptRateLimitRepository } from "../../repositories/memory/memory.prompt-rate-limit.repository.ts";
import type { PromptService } from "../../services/prompt.service.ts";
import { promptRest, promptRestFacts } from "../prompt.rest.ts";

export const PROMPT_TEST_PROJECT = "project_authorized";
export const PROMPT_TEST_ORGANIZATION = "org_1";

/** The real application over a scripted engine, so the family's own operations run. */
export function buildPromptApp(prompts: PromptService): PromptModule {
  return PromptModule.createWithPrompts(
    {
      dependencies: {
        projects: createApiFixture<ProjectApi>(),
        permissions: createApiFixture<AuthzApi>(),
        plans: createApiFixture<EntitlementApi>(),
        workflow: createApiFixture<WorkflowApi>(),
        modelProviders: defaultModelFixture(),
      },
      members: { publicBaseUrl: "https://app.langwatch.test" },
      repositories: { rateLimits: MemoryPromptRateLimitRepository.create() },
      config: undefined,
      resources: { own: () => {}, ownService: () => {} },
      secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    },
    prompts,
  );
}

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
    credential: "project",
    onError: canonicalErrorResponse,
    facts: [
      bindRestMiddleware(promptRestFacts, () => ({
        organizationId,
        promptsUrl: "https://app.test/authorized/prompts",
      })),
    ],
  });

  return {
    request: (path: string, init?: RequestInit) =>
      hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}
