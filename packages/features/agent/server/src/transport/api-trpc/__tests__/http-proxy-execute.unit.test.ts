/**
 * @vitest-environment node
 *
 * `httpProxy.execute` dispatches the same `http` node a real run builds to
 * the workflow engine, so a private-address refusal, a template variable,
 * an auth secret and a response header are all shaped by the engine's
 * report of that node — never rebuilt or re-checked at this transport.
 *
 * @see specs/agents/http-agent-test-parity.feature
 */
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";
import type { StudioClientEvent, StudioServerEvent } from "@langwatch/workflow-contract";
import { HttpProxyTrpcApi } from "../http-proxy.api";

type ExecutionState = Extract<
  StudioServerEvent,
  { type: "component_state_change" }
>["payload"]["execution_state"];

function harness(state: ExecutionState) {
  let dispatchedEvent: StudioClientEvent | undefined;

  const trpc = initTRPC.context<{ actor(): { id: string } }>().create();
  const router = HttpProxyTrpcApi.create(
    trpc,
    {
      protected: trpc.procedure,
      policy: () => (procedure) => procedure,
    },
    {
      postStudioEvent: async (_request, { event, onEvent }) => {
        dispatchedEvent = event;
        onEvent({
          type: "component_state_change",
          payload: { component_id: "http_agent_test", execution_state: state },
        } as StudioServerEvent);
      },
      recordAgentTestTrace: async () => {},
    },
  );

  const caller = trpc.createCallerFactory(router)({ actor: () => ({ id: "user_1" }) });

  const dispatchedParameters = (): Record<string, unknown> => {
    if (dispatchedEvent?.type !== "execute_component") throw new Error("wrong event type");
    const event = dispatchedEvent;
    const node = event.payload.workflow.nodes.find(
      (candidate) => candidate.id === event.payload.node_id,
    );
    return Object.fromEntries(
      (node?.data.parameters ?? []).map((parameter) => [parameter.identifier, parameter.value]),
    );
  };

  return {
    caller,
    dispatchedParameters,
    dispatchedInputs: () =>
      dispatchedEvent?.type === "execute_component" ? dispatchedEvent.payload.inputs : undefined,
  };
}

const REQUEST = {
  projectId: "project_1",
  url: "https://api.example.com/chat",
  method: "POST" as const,
  bodyTemplate: '{"q": "{{ input }}"}',
  templateVariables: { input: "hello" },
};

describe("httpProxy.execute", () => {
  describe("when the engine reports a successful call", () => {
    /** @scenario "an agent on an internal address that tests green also runs green" */
    it("dispatches the request to the engine instead of calling out itself", async () => {
      const { caller, dispatchedParameters } = harness({
        status: "success",
        outputs: { output: "hi" },
      } as ExecutionState);

      const result = await caller.execute(REQUEST);

      expect(result.success).toBe(true);
      expect(dispatchedParameters().url).toBe("https://api.example.com/chat");
    });

    /** @scenario "a template written with spaces around the variable is substituted" */
    it("sends the template and its variables rather than a rendered body", async () => {
      const { caller, dispatchedParameters, dispatchedInputs } = harness({
        status: "success",
        outputs: { output: "hi" },
      } as ExecutionState);

      await caller.execute(REQUEST);

      expect(dispatchedParameters().body_template).toBe('{"q": "{{ input }}"}');
      expect(dispatchedInputs()).toEqual({ input: "hello" });
    });

    /** @scenario "a successful test reports status, duration and response headers" */
    it("reports the status, duration and response headers it observed", async () => {
      const { caller } = harness({
        status: "success",
        outputs: { output: "the answer" },
        timestamps: { started_at: 1_000, finished_at: 1_250 },
        http: {
          status_code: 200,
          status_text: "OK",
          response_headers: { "Content-Type": "application/json" },
        },
      } as ExecutionState);

      const result = await caller.execute(REQUEST);

      expect(result).toMatchObject({
        success: true,
        status: 200,
        statusText: "OK",
        duration: 250,
        responseHeaders: { "Content-Type": "application/json" },
        extractedOutput: "the answer",
      });
    });

    /** @scenario "the panel shows the body the engine actually sent" */
    it("reports the body the engine rendered, not one rendered here", async () => {
      const { caller } = harness({
        status: "success",
        outputs: { output: "the answer" },
        http: { status_code: 200, rendered_body: '{"q": "hello"}' },
      } as ExecutionState);

      const result = await caller.execute(REQUEST);

      expect(result.renderedBody).toBe('{"q": "hello"}');
    });

    /** @scenario "a variable the template references but the test does not supply is reported" */
    it("passes on the unresolved template variables the engine warned about", async () => {
      const { caller } = harness({
        status: "success",
        outputs: { output: "" },
        http: {
          status_code: 200,
          warnings: ["template variable not found: question"],
        },
      } as ExecutionState);

      const result = await caller.execute(REQUEST);

      expect(result.warnings).toEqual(["template variable not found: question"]);
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
        const { caller } = harness({
          status: "success",
          outputs: { output: "ok" },
          http: { status_code: 200, rendered_body: '{"q": "hello"}' },
        } as ExecutionState);

        const result = await caller.execute({ ...REQUEST, auth });

        expect(JSON.stringify(result)).not.toContain(secret);
      });
    }
  });

  describe("when the engine reports a failure", () => {
    /** @scenario "a non-2xx response fails the test and keeps the upstream body" */
    it("fails the test while keeping the response detail", async () => {
      const { caller } = harness({
        status: "error",
        error: "httpblock: upstream returned 500",
        error_type: "upstream_http_error",
        upstream_status: 500,
        http: {
          status_code: 500,
          status_text: "Internal Server Error",
          response_headers: { "Content-Type": "text/plain" },
        },
      } as ExecutionState);

      const result = await caller.execute(REQUEST);

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
      const { caller } = harness({
        status: "error",
        error: "ssrf_blocked",
        error_type: "ssrf_blocked",
      } as ExecutionState);

      const result = await caller.execute(REQUEST);

      expect(result.success).toBe(false);
      expect(result.error).toBe("ssrf_blocked");
    });
  });
});
