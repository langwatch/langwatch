/**
 * What the playground execution RPC puts on the wire: who it turns away, in
 * which order, and what an accepted run streams back.
 *
 * Authentication, RBAC and the workflow engine are mocked because they are the
 * boundaries here — what is under test is that the route asks them, in the
 * right order (origin gate, then session, then project permission, then
 * validation), and that every refusal reaches the client as a code the error
 * registry can render rather than a bare status or a prose blob.
 *
 * @see specs/prompts/playground-conversation.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PLAYGROUND_API_VERSION,
  PROMPT_EXECUTE_ENDPOINT,
} from "~/prompts/prompt-playground/executeContract";

const session = {
  user: { id: "user_1", name: "Tester", email: "tester@example.com" },
  expires: new Date(Date.now() + 60_000).toISOString(),
};

const getServerAuthSession = vi.hoisted(() => vi.fn());
const hasProjectPermission = vi.hoisted(() => vi.fn());
const isAllowedAuthOrigin = vi.hoisted(() => vi.fn());
const studioBackendPostEvent = vi.hoisted(() => vi.fn());

vi.mock("~/server/auth", () => ({ getServerAuthSession }));
// Only the permission check is replaced: the rest of the module is the
// permission catalogue and the demo-project rule, both of which the route
// reads for real.
vi.mock("~/server/api/rbac", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/api/rbac")>()),
  hasProjectPermission,
}));
vi.mock("~/server/better-auth/originGate", () => ({ isAllowedAuthOrigin }));
vi.mock("~/app/api/workflows/post_event/post-event", () => ({
  studioBackendPostEvent,
}));
// The engine-facing preparation steps pass the event through untouched: what
// they add (credentials, datasets) is not on the wire this suite reads.
vi.mock("~/optimization_studio/server/addEnvs", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/optimization_studio/server/addEnvs")
  >()),
  addEnvs: vi.fn(async (event: unknown) => event),
}));
vi.mock("~/optimization_studio/server/loadDatasets", () => ({
  loadDatasets: vi.fn(async (event: unknown) => event),
}));

import { app } from "../[[...route]]/app";

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

function execute(body: Record<string, unknown> = {}) {
  return app.request(PROMPT_EXECUTE_ENDPOINT, {
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
}

describe(`POST ${PROMPT_EXECUTE_ENDPOINT}`, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isAllowedAuthOrigin.mockReturnValue(true);
    getServerAuthSession.mockResolvedValue(session);
    hasProjectPermission.mockResolvedValue(true);
    studioBackendPostEvent.mockImplementation(
      async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
        onEvent({ type: "done" });
      },
    );
  });

  describe("when the caller holds prompts:view on the project", () => {
    /** @scenario A viewer can run a prompt in the playground */
    it("accepts the execution and streams start and done", async () => {
      const response = await execute();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      const body = await response.text();
      expect(body).toContain('"type":"start"');
      expect(body).toContain('"type":"done"');
    });

    it("checks the permission against the project the body names", async () => {
      await execute({ projectId: "project_other" });

      expect(hasProjectPermission).toHaveBeenCalledWith(
        expect.objectContaining({ session }),
        "project_other",
        "prompts:view",
      );
    });
  });

  describe("when the caller lacks prompts:view on the project", () => {
    /** @scenario Execution is refused without permission to view prompts */
    it("refuses with a code the error registry can render", async () => {
      hasProjectPermission.mockResolvedValue(false);

      const response = await execute();

      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: "insufficient_permissions",
      });
      expect(studioBackendPostEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the caller has no session", () => {
    it("refuses before the permission check runs", async () => {
      getServerAuthSession.mockResolvedValue(null);

      const response = await execute();

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        code: "missing_credentials",
      });
      expect(hasProjectPermission).not.toHaveBeenCalled();
    });
  });

  describe("when the request comes from another origin", () => {
    it("refuses before the session is read", async () => {
      isAllowedAuthOrigin.mockReturnValue(false);

      const response = await execute();

      expect(response.status).toBe(403);
      expect(getServerAuthSession).not.toHaveBeenCalled();
    });
  });

  describe("when the project is the demo project", () => {
    it("refuses even though the demo grants prompts:view to everyone", async () => {
      // Restored rather than deleted: an instance that configures a demo
      // project has this set before the suite runs, and deleting it would
      // change what every later test sees.
      const previousDemoProjectId = process.env.DEMO_PROJECT_ID;
      process.env.DEMO_PROJECT_ID = "project_demo";
      try {
        const response = await execute({ projectId: "project_demo" });

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          code: "insufficient_permissions",
        });
        expect(studioBackendPostEvent).not.toHaveBeenCalled();
      } finally {
        if (previousDemoProjectId === undefined) {
          delete process.env.DEMO_PROJECT_ID;
        } else {
          process.env.DEMO_PROJECT_ID = previousDemoProjectId;
        }
      }
    });
  });

  describe("when a caller posts an arbitrary workflow", () => {
    /** @scenario Execution does not accept a caller-supplied workflow */
    it("rejects the request as malformed", async () => {
      const response = await execute({
        workflow: { nodes: [{ id: "attacker" }] },
      });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "validation_error" });
      expect(studioBackendPostEvent).not.toHaveBeenCalled();
    });
  });

  describe("when the version segment is omitted or unknown", () => {
    it("still serves the dated path the client is pinned to", async () => {
      expect(PROMPT_EXECUTE_ENDPOINT).toContain(PLAYGROUND_API_VERSION);

      const response = await app.request(
        "/api/prompt-playground/2000-01-01/prompt.execute",
        { method: "POST" },
      );
      expect(response.status).toBe(404);
    });

    it("refuses the unversioned path rather than treating it as the latest", async () => {
      const response = await app.request(
        "/api/prompt-playground/prompt.execute",
        { method: "POST" },
      );

      expect(response.status).toBe(404);
      expect(studioBackendPostEvent).not.toHaveBeenCalled();
    });
  });
});
