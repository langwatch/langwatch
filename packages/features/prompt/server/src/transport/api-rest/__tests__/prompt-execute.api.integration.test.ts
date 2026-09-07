/**
 * What the playground execution door puts on the wire: who it turns away, in
 * which order, and what an accepted run streams back.
 *
 * Authentication, RBAC and the workflow engine are ports because they are the
 * boundaries here — what is under test is that the route asks them, in the
 * right order (origin gate, then session, then project permission), and that
 * an accepted run frames the engine's events as playground stream events.
 *
 * @see specs/prompts/playground-conversation.feature
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { PROMPT_EXECUTE_ENDPOINT } from "@langwatch/prompt-contract";
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPromptExecuteRestApp,
  type PromptExecuteRestPorts,
  type PromptExecuteRestSession,
} from "../prompt-execute.api.ts";

/** Hono's own refusal wins; anything else degrades to the generic unknown. */
const boundaryErrorHandler: ErrorHandler = (error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  if (error instanceof Error && "httpStatus" in error) {
    const handled = error as Error & { httpStatus: number; code: string };
    return c.json({ code: handled.code }, handled.httpStatus as 403);
  }
  return c.json({ error: "Internal Server Error" }, 500);
};

function testSecurity(): AppRestSecurity {
  const pass: MiddlewareHandler = async (_c, next) => next();
  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: boundaryErrorHandler,
    canonicalErrorHandler: boundaryErrorHandler,
    authenticateProject: () => pass,
    authorizeProjectPermission: () => pass,
    authorizeApiKeyCeiling: () => pass,
    authenticateOrganization: () => pass,
    authorizeOrganizationPermission: () => pass,
    authorizeRouteTeamPermission: () => pass,
    authorizeRouteProjectPermission: () => pass,
    authenticateOrganizationThrowing: pass,
    authorizeOrganizationPermissionThrowing: () => pass,
  };
  return createAppRestSecurity(ports);
}

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

function buildApi(overrides: Partial<PromptExecuteRestPorts<PromptExecuteRestSession>> = {}) {
  const isAllowedOrigin = vi.fn(() => true);
  const resolveSession = vi.fn(async () => SESSION as PromptExecuteRestSession | null);
  const probeProjectPermission = vi.fn(async () => true);
  const prepareStudioEvent = vi.fn(async (input: { event: StudioClientEvent }) => input.event);
  const postEvent = vi.fn(async ({ onEvent }: { onEvent: (event: { type: "done" }) => void }) => {
    onEvent({ type: "done" });
  });

  const ports = {
    isAllowedOrigin,
    resolveSession,
    probeProjectPermission,
    isDemoProject: () => false,
    prepareStudioEvent,
    postEvent,
    newTraceId: () => "trace_1",
    ...overrides,
  } as unknown as PromptExecuteRestPorts<PromptExecuteRestSession>;

  const app = createPromptExecuteRestApp<PromptExecuteRestSession>({
    security: testSecurity(),
    ports,
  });

  const execute = (body: Record<string, unknown> = {}) =>
    app.request(PROMPT_EXECUTE_ENDPOINT, {
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
    app,
    execute,
    isAllowedOrigin,
    resolveSession,
    probeProjectPermission,
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
        resolveSession: async () => null,
        probeProjectPermission,
      });

      const response = await execute();

      expect(response.status).toBe(401);
      expect(probeProjectPermission).not.toHaveBeenCalled();
    });
  });

  describe("when the request comes from another origin", () => {
    it("refuses before the session is read", async () => {
      const resolveSession = vi.fn(async () => SESSION as PromptExecuteRestSession | null);
      const { execute } = buildApi({
        isAllowedOrigin: () => false,
        resolveSession,
      });

      const response = await execute();

      expect(response.status).toBe(403);
      expect(resolveSession).not.toHaveBeenCalled();
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
      const { app } = buildApi();

      const response = await app.request("/api/prompt-playground/2000-01-01/prompt.execute", {
        method: "POST",
      });

      expect(response.status).toBe(404);
    });
  });
});
