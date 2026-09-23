import { createApiFixture } from "@langwatch/api-fixture";
/**
 * Tests the playground execution endpoint: authentication, RBAC, and workflow engine
 * integration. Verifies request order (origin gate, session, project permission) and
 * that accepted runs stream playground events. Spec: specs/prompts/playground-conversation.feature
 */
import { createRestRuntime } from "@langwatch/api/rest";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { RateLimiter } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import {
  PROMPT_EXECUTE_ENDPOINT,
  CrossOriginRefusedError,
  PromptPlaygroundSignInRequiredError,
} from "@langwatch/prompt-contract";
import type { StudioClientEvent, WorkflowApi } from "@langwatch/workflow-contract";
import type { ErrorHandler } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PromptExecuteBoundsService } from "../../services/prompt-execute-bounds.service.ts";
import { PromptExecutionService } from "../../services/prompt-execution.service.ts";
import { promptExecuteRest } from "../prompt-execute.rest.ts";

/** Every handled refusal wins by its own status; anything else is the generic unknown. */
const boundaryErrorHandler: ErrorHandler = (error, c) => {
  if (!(error instanceof Error)) return c.json({ error: "Internal Server Error" }, 500);
  if (!("httpStatus" in error && typeof error.httpStatus === "number")) {
    return c.json({ error: "Internal Server Error" }, 500);
  }
  if (!("code" in error && typeof error.code === "string")) {
    return c.json({ error: "Internal Server Error" }, 500);
  }

  {
    return new Response(JSON.stringify({ code: error.code }), {
      status: error.httpStatus,
      headers: { "Content-Type": "application/json" },
    });
  }
};

/** The smallest form the wire schema accepts. */
const formValues = {
  handle: null,
  scope: "PROJECT",
  version: {
    parameters: {},
    configData: {
      messages: [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "{{input}}" },
      ],
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      llm: { model: "openai/gpt-5-mini" },
    },
  },
};

type PromptExecuteRestSession = Readonly<{ user: Readonly<{ id: string }> }>;
type TestOptions = {
  isAllowedOrigin(): boolean;
  findSession(request: Request): Promise<PromptExecuteRestSession | null>;
  probeProjectPermission(
    session: PromptExecuteRestSession,
    projectId: string,
    permission: string,
  ): Promise<boolean>;
  demoProjectId?: string;
  rateLimitAllowed?: boolean;
  maxMessages?: number;
};

const SESSION: PromptExecuteRestSession = { user: { id: "user_1" } };

function buildApi(overrides: Partial<TestOptions> = {}) {
  const isAllowedOrigin = vi.fn(() => true);
  const findSession = vi.fn(async () => SESSION as PromptExecuteRestSession | null);
  const probeProjectPermission = vi.fn(async () => true);
  const prepareStudioEvent = vi.fn(async (input: { event: StudioClientEvent }) => input.event);
  const postStudioEvent = vi.fn(
    async ({ onEvent }: { onEvent: (event: { type: "done" }) => void }) => {
      onEvent({ type: "done" });
    },
  );
  const requestBound = vi.fn(async ({ key }: { key: string }) =>
    key === "promptMessagesMax" ? (overrides.maxMessages ?? 100) : 100,
  );
  const rateLimiterCheck = vi.fn<RateLimiter["check"]>(async () => ({
    allowed: overrides.rateLimitAllowed ?? true,
    ...(overrides.rateLimitAllowed === false ? { retryAfterSeconds: 42 } : {}),
  }));
  const options = {
    isAllowedOrigin,
    findSession,
    probeProjectPermission,
    ...overrides,
  } satisfies TestOptions;
  const bounds = PromptExecuteBoundsService.create({
    entitlement: createApiFixture<EntitlementApi>({ requestBound }),
    projects: createApiFixture<ProjectApi>({ getOrganizationId: async () => "organization_1" }),
    rateLimiter: createApiFixture<RateLimiter>({ check: rateLimiterCheck }),
  });
  const execution = PromptExecutionService.create({
    workflow: createApiFixture<WorkflowApi>({
      prepareStudioEvent,
      postStudioEvent,
      reportStudioFailure: () => undefined,
    }),
    authz: createApiFixture<AuthzApi>({
      isDemoProject: ({ projectId }) => projectId === options.demoProjectId,
    }),
    bounds,
  });
  const app = createApiFixture<PromptApi>({
    executePlayground: (input) => execution.execute(input),
  });

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: null }),
      identify: async ({ request }) => {
        if (!options.isAllowedOrigin()) throw new CrossOriginRefusedError();
        const session = await options.findSession(request);
        if (!session) throw new PromptPlaygroundSignInRequiredError();
        return { actor: { type: "user", id: session.user.id }, scope: null };
      },
      authorize: async ({ target, permission }) => ({
        permitted: await options.probeProjectPermission(SESSION, target.id, permission),
        organizationRole: null,
      }),
    },
  });

  const hono = runtime.mount(promptExecuteRest.router(), {
    app: () => app,
    onError: boundaryErrorHandler,
  });

  const execute = (body: Record<string, unknown> = {}) =>
    hono.request(`http://api.test${PROMPT_EXECUTE_ENDPOINT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: "project_1",
        formValues,
        variables: [],
        messages: [{ role: "user", content: "hello" }],
        ...body,
      }),
    });

  return {
    hono,
    execute,
    isAllowedOrigin,
    findSession,
    probeProjectPermission,
    rateLimiterCheck,
    prepareStudioEvent,
    postEvent: postStudioEvent,
  };
}

describe(`POST ${PROMPT_EXECUTE_ENDPOINT}`, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when the caller holds prompts:view on the project", () => {
    /** @scenario A viewer can run a prompt in the playground */
    it("accepts the execution and streams start and done", async () => {
      const { execute } = buildApi();

      const response = await execute();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const body = await response.text();
      expect(body).toContain('"type":"start"');
      expect(body).toContain('"type":"done"');
    });

    it("checks the permission against the project the body names", async () => {
      const { execute, probeProjectPermission } = buildApi();

      await execute({ projectId: "project_other" });

      expect(probeProjectPermission).toHaveBeenCalledWith(SESSION, "project_other", "prompts:view");
    });
  });

  describe("when the caller lacks prompts:view on the project", () => {
    /** @scenario Execution is refused without permission to view prompts */
    it("refuses and never opens a run", async () => {
      const { execute, postEvent } = buildApi({
        probeProjectPermission: async () => false,
      });

      const response = await execute();

      expect(response.status).toBe(403);
      expect(postEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the caller has no session", () => {
    it("refuses before the permission check runs", async () => {
      const probeProjectPermission = vi.fn(async () => true);
      const { execute } = buildApi({
        findSession: async () => null,
        probeProjectPermission,
      });

      const response = await execute();

      expect(response.status).toBe(401);
      expect(probeProjectPermission).not.toHaveBeenCalled();
    });
  });

  describe("when the request comes from another origin", () => {
    it("refuses before the session is read", async () => {
      const findSession = vi.fn(async () => SESSION as PromptExecuteRestSession | null);
      const { execute } = buildApi({
        isAllowedOrigin: () => false,
        findSession,
      });

      const response = await execute();

      expect(response.status).toBe(403);
      expect(findSession).not.toHaveBeenCalled();
    });
  });

  describe("when the project is the demo project", () => {
    it("refuses even though the demo grants prompts:view to everyone", async () => {
      const { execute, postEvent } = buildApi({ demoProjectId: "project_1" });

      const response = await execute();

      expect(response.status).toBe(403);
      expect(postEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the project has spent its run window", () => {
    it("refuses 429 and never opens a run", async () => {
      const { execute, prepareStudioEvent, postEvent } = buildApi({ rateLimitAllowed: false });

      const response = await execute();

      expect(response.status).toBe(429);
      expect(prepareStudioEvent).not.toHaveBeenCalled();
      expect(postEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the message array is over the plan's bound", () => {
    it("refuses 422 and never opens a run", async () => {
      const { execute, prepareStudioEvent, postEvent } = buildApi({ maxMessages: 0 });

      const response = await execute();

      expect(response.status).toBe(422);
      expect(prepareStudioEvent).not.toHaveBeenCalled();
      expect(postEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the budget check passes", () => {
    it("counts the run against the project the body names, with its message count", async () => {
      const { execute, rateLimiterCheck } = buildApi();

      await execute({ projectId: "project_other" });

      expect(rateLimiterCheck).toHaveBeenCalledWith("prompt-execute:project_other", {
        requests: 100,
        seconds: 60,
      });
    });
  });

  describe("when a caller posts an arbitrary workflow", () => {
    /** @scenario Execution does not accept a caller-supplied workflow */
    it("rejects the request as malformed", async () => {
      const { execute, postEvent } = buildApi();

      const response = await execute({ workflow: { nodes: [{ id: "attacker" }] } });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect(postEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the version segment is unknown", () => {
    it("answers 404 instead of falling through", async () => {
      const { hono } = buildApi();

      const response = await hono.request(
        "http://api.test/api/prompt-playground/2000-01-01/prompt.execute",
        {
          method: "POST",
        },
      );

      expect(response.status).toBe(404);
    });
  });
});
