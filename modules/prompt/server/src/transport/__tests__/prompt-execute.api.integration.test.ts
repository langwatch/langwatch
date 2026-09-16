/**
 * Tests the playground execution endpoint: authentication, RBAC, and workflow engine
 * integration. Verifies request order (origin gate, session, project permission) and
 * that accepted runs stream playground events. Spec: specs/prompts/playground-conversation.feature
 */
import { bindRestMiddleware, createRestRuntime } from "@langwatch/api/rest";
import {
  PROMPT_EXECUTE_ENDPOINT,
  PromptExecuteRateLimitedError,
  PromptMessagesTooManyError,
} from "@langwatch/prompt-contract";
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import type { ErrorHandler } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  promptExecuteRest,
  promptExecuteRestMembers,
  type PromptExecuteRestMembers,
  type PromptExecuteRestSession,
} from "../prompt-execute.api.ts";

/** Every handled refusal wins by its own status; anything else is the generic unknown. */
const boundaryErrorHandler: ErrorHandler = (error, c) => {
  if (error instanceof Error && "httpStatus" in error) {
    const handled = error as Error & { httpStatus: number; code: string };
    return c.json({ code: handled.code }, handled.httpStatus as 403);
  }
  return c.json({ error: "Internal Server Error" }, 500);
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

const SESSION: PromptExecuteRestSession = { user: { id: "user_1" } };

function buildApi(overrides: Partial<PromptExecuteRestMembers<PromptExecuteRestSession>> = {}) {
  const isAllowedOrigin = vi.fn(() => true);
  const findSession = vi.fn(async () => SESSION as PromptExecuteRestSession | null);
  const probeProjectPermission = vi.fn(async () => true);
  const assertExecuteWithinBounds = vi.fn(async () => {});
  const prepareStudioEvent = vi.fn(async (input: { event: StudioClientEvent }) => input.event);
  const postEvent = vi.fn(async ({ onEvent }: { onEvent: (event: { type: "done" }) => void }) => {
    onEvent({ type: "done" });
  });

  const members = {
    isAllowedOrigin,
    findSession,
    probeProjectPermission,
    isDemoProject: () => false,
    assertExecuteWithinBounds,
    prepareStudioEvent,
    postEvent,
    newTraceId: () => "trace_1",
    ...overrides,
  } as unknown as PromptExecuteRestMembers<PromptExecuteRestSession>;

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: null }),
      identify: () => ({ actor: null, scope: null }),
    },
  });

  const hono = runtime.mount(promptExecuteRest.router(), {
    app: () => ({}) as never,
    onError: boundaryErrorHandler,
    facts: [bindRestMiddleware(promptExecuteRestMembers, () => members)],
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
    assertExecuteWithinBounds,
    prepareStudioEvent,
    postEvent,
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
      const { execute, postEvent } = buildApi({ isDemoProject: () => true });

      const response = await execute();

      expect(response.status).toBe(403);
      expect(postEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the project has spent its run window", () => {
    it("refuses 429 and never opens a run", async () => {
      const { execute, prepareStudioEvent, postEvent } = buildApi({
        assertExecuteWithinBounds: async () => {
          throw new PromptExecuteRateLimitedError({ retryAfterSeconds: 42 });
        },
      });

      const response = await execute();

      expect(response.status).toBe(429);
      expect(prepareStudioEvent).not.toHaveBeenCalled();
      expect(postEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the message array is over the plan's bound", () => {
    it("refuses 422 and never opens a run", async () => {
      const { execute, prepareStudioEvent, postEvent } = buildApi({
        assertExecuteWithinBounds: async () => {
          throw new PromptMessagesTooManyError(100);
        },
      });

      const response = await execute();

      expect(response.status).toBe(422);
      expect(prepareStudioEvent).not.toHaveBeenCalled();
      expect(postEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the budget check passes", () => {
    it("counts the run against the project the body names, with its message count", async () => {
      const { execute, assertExecuteWithinBounds } = buildApi();

      await execute({ projectId: "project_other" });

      expect(assertExecuteWithinBounds).toHaveBeenCalledWith({
        projectId: "project_other",
        messageCount: 1,
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
