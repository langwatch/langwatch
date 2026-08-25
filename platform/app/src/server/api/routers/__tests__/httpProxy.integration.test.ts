/**
 * @vitest-environment node
 *
 * The test button's job is no longer to make an HTTP request. It builds the
 * same `http` node an evaluation builds and hands it to the workflow engine,
 * so these tests are about the node that goes out and the result that comes
 * back, not about auth headers or JSONPath: those belong to the engine now and
 * are covered in services/nlpgo/app/engine/blocks/httpblock.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Field } from "@langwatch/workflow-contract";
import type { StudioClientEvent } from "~/optimization_studio/types/events";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { getTestUser } from "../../../../utils/testUtils";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";
import { engineRepliesWith } from "./agentTestEngine";

wireDefaultTestApp();

const mockPostEvent = vi.fn();
vi.mock("~/app/api/workflows/post_event/post-event", () => ({
  studioBackendPostEvent: (args: unknown) => mockPostEvent(args),
}));

// The env decoration reads project credentials from the database and has
// nothing to do with the node under test.
vi.mock("~/optimization_studio/server/addEnvs", () => ({
  addEnvs: (event: unknown) => Promise.resolve(event),
}));

// Proves the request never leaves through the app's own client any more.
const mockSsrfSafeFetch = vi.fn();
vi.mock("~/utils/ssrfProtection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/ssrfProtection")>()),
  ssrfSafeFetch: (...args: unknown[]) => mockSsrfSafeFetch(...args),
}));

const engineReplies = engineRepliesWith(mockPostEvent);

/** The event the router handed to the engine. */
const dispatchedEvent = (): StudioClientEvent =>
  mockPostEvent.mock.calls[0]?.[0]?.message as StudioClientEvent;

const dispatchedParameters = (): Record<string, unknown> => {
  const event = dispatchedEvent();
  if (event.type !== "execute_component") throw new Error("wrong event type");
  const node = event.payload.workflow.nodes.find(
    (candidate) => candidate.id === event.payload.node_id,
  );
  return Object.fromEntries(
    (node?.data.parameters ?? []).map((parameter: Field) => [
      parameter.identifier,
      parameter.value,
    ]),
  );
};

describe("HTTP agent test button", () => {
  const projectId = "test-project-id";
  let caller: ReturnType<typeof appRouter.createCaller>;

  const testRequest = {
    projectId,
    url: "https://api.example.com/chat",
    method: "POST" as const,
    bodyTemplate: '{"q": "{{ input }}"}',
    templateVariables: { input: "hello" },
  };

  beforeAll(async () => {
    const user = await getTestUser();
    caller = appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: user.id }, expires: "1" },
      }),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("when the agent is tested", () => {
    /** @scenario "an agent on an internal address that tests green also runs green" */
    it("dispatches the request to the engine instead of calling out itself", async () => {
      engineReplies({ status: "success", outputs: { output: "hi" } });

      await caller.httpProxy.execute(testRequest);

      expect(mockPostEvent).toHaveBeenCalledTimes(1);
      expect(mockSsrfSafeFetch).not.toHaveBeenCalled();
      expect(dispatchedEvent().type).toBe("execute_component");
    });

    /** @scenario "a template written with spaces around the variable is substituted" */
    it("sends the template and its variables rather than a rendered body", async () => {
      engineReplies({ status: "success", outputs: { output: "hi" } });

      await caller.httpProxy.execute(testRequest);

      const event = dispatchedEvent();
      if (event.type !== "execute_component") throw new Error("wrong event");

      expect(dispatchedParameters().body_template).toBe('{"q": "{{ input }}"}');
      expect(event.payload.inputs).toEqual({ input: "hello" });
    });

    it("carries the agent's configuration onto the node", async () => {
      engineReplies({ status: "success", outputs: { output: "hi" } });

      await caller.httpProxy.execute({
        ...testRequest,
        headers: [{ key: " X-Trace ", value: "yes" }],
        auth: { type: "bearer", token: "s3cret" },
        outputPath: "$.choices[0].message.content",
        timeoutMs: 4000,
      });

      expect(dispatchedParameters()).toMatchObject({
        url: "https://api.example.com/chat",
        method: "POST",
        output_path: "$.choices[0].message.content",
        timeout_ms: 4000,
        auth_type: "bearer",
        auth_token: "s3cret",
        headers: expect.objectContaining({ "X-Trace": "yes" }),
      });
    });
  });

  describe("when the engine reports a successful call", () => {
    /** @scenario "a successful test reports status, duration and response headers" */
    it("reports the status, duration and response headers it observed", async () => {
      engineReplies({
        status: "success",
        outputs: { output: "the answer" },
        timestamps: { started_at: 1_000, finished_at: 1_250 },
        http: {
          status_code: 200,
          status_text: "OK",
          response_headers: { "Content-Type": "application/json" },
        },
      });

      const result = await caller.httpProxy.execute(testRequest);

      expect(result).toMatchObject({
        success: true,
        status: 200,
        statusText: "OK",
        duration: 250,
        responseHeaders: { "Content-Type": "application/json" },
        extractedOutput: "the answer",
      });
    });

    it("measures the call itself when the engine timed only one end of it", async () => {
      engineReplies({
        status: "success",
        outputs: { output: "the answer" },
        timestamps: { finished_at: 1_770_000_000_000 },
      });

      const result = await caller.httpProxy.execute(testRequest);

      // Subtracting a missing start would report the epoch as a duration and
      // the panel would say the request took fifty-odd years.
      expect(result.duration).toBeLessThan(60_000);
    });

    /** @scenario "the panel shows the body the engine actually sent" */
    it("reports the body the engine rendered, not one rendered here", async () => {
      engineReplies({
        status: "success",
        outputs: { output: "the answer" },
        http: { status_code: 200, rendered_body: '{"q": "hello"}' },
      });

      const result = await caller.httpProxy.execute(testRequest);

      expect(result.renderedBody).toBe('{"q": "hello"}');
    });

    /** @scenario "a variable the template references but the test does not supply is reported" */
    it("passes on the unresolved template variables the engine warned about", async () => {
      engineReplies({
        status: "success",
        outputs: { output: "" },
        http: {
          status_code: 200,
          warnings: ["template variable not found: question"],
        },
      });

      const result = await caller.httpProxy.execute(testRequest);

      expect(result.warnings).toEqual([
        "template variable not found: question",
      ]);
    });

    it("stringifies an output that is not a string", async () => {
      engineReplies({
        status: "success",
        outputs: { output: { nested: ["a", 1] } },
      });

      const result = await caller.httpProxy.execute(testRequest);

      expect(result.extractedOutput).toBe('{"nested":["a",1]}');
      expect(result.response).toEqual({ nested: ["a", 1] });
    });
  });

  describe("when the agent authenticates", () => {
    const secret = "s3cret-value-do-not-echo";
    const schemes = [
      { name: "bearer", auth: { type: "bearer" as const, token: secret } },
      {
        name: "api key",
        auth: { type: "api_key" as const, header: "X-API-Key", value: secret },
      },
      {
        name: "basic",
        auth: { type: "basic" as const, username: "user", password: secret },
      },
    ];

    for (const { name, auth } of schemes) {
      /** @scenario "the auth secret is not present in the test response" */
      it(`keeps the ${name} secret out of what it hands back`, async () => {
        engineReplies({
          status: "success",
          outputs: { output: "ok" },
          http: { status_code: 200, rendered_body: '{"q": "hello"}' },
        });

        const result = await caller.httpProxy.execute({
          ...testRequest,
          auth,
        });

        expect(JSON.stringify(result)).not.toContain(secret);
      });
    }
  });

  describe("when the engine reports a failure", () => {
    /** @scenario "a non-2xx response fails the test and keeps the upstream body" */
    it("fails the test while keeping the response detail", async () => {
      engineReplies({
        status: "error",
        error: "httpblock: upstream returned 500",
        error_type: "upstream_http_error",
        upstream_status: 500,
        http: {
          status_code: 500,
          status_text: "Internal Server Error",
          response_headers: { "Content-Type": "text/plain" },
        },
      });

      const result = await caller.httpProxy.execute(testRequest);

      expect(result).toMatchObject({
        success: false,
        status: 500,
        statusText: "Internal Server Error",
        error: "httpblock: upstream returned 500",
        responseHeaders: { "Content-Type": "text/plain" },
      });
    });

    /** @scenario "an agent on an internal address that is refused is refused in the test too" */
    it("surfaces a blocked address the same way a run would", async () => {
      engineReplies({
        status: "error",
        error: "ssrf_blocked",
        error_type: "ssrf_blocked",
      });

      const result = await caller.httpProxy.execute(testRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe("ssrf_blocked");
    });

    it("fails a dispatch that never reached the engine without quoting it", async () => {
      mockPostEvent.mockRejectedValue(
        new Error("connect ECONNREFUSED 10.4.1.9:5560"),
      );

      const result = await caller.httpProxy.execute(testRequest);

      expect(result.success).toBe(false);
      // Reaching the engine is our problem and its transport error names our
      // hosts. The author gets the generic failure; the detail is in the log.
      expect(JSON.stringify(result)).not.toContain("10.4.1.9");
      expect(result.error).toBeUndefined();
    });

    it("reports an engine that answered without a node result", async () => {
      mockPostEvent.mockImplementation(async () => {
        // no component_state_change at all
      });

      const result = await caller.httpProxy.execute(testRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it("ignores a state change belonging to another component", async () => {
      mockPostEvent.mockImplementation(
        async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
          onEvent({
            type: "component_state_change",
            payload: {
              component_id: "some_other_node",
              execution_state: { status: "success", outputs: { output: "hi" } },
            },
          });
        },
      );

      const result = await caller.httpProxy.execute(testRequest);

      // Reading another node's outputs would report a success this agent never
      // had, which is the one wrong answer worse than no answer.
      expect(result.success).toBe(false);
      expect(result.response).toBeUndefined();
    });
  });
});
