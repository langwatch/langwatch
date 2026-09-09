import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { WorkflowApi, ExecuteWorkflowComponentInput } from "@langwatch/workflow-contract";
import type { TraceApi } from "@langwatch/trace-contract";
/**
 * @vitest-environment node
 * @see specs/agents/http-agent-test-parity.feature
 */
import { describe, expect, it } from "vitest";
import type { ExecutionState } from "@langwatch/workflow-contract";
import { createHttpProxyCaller } from "./http-proxy.fixture.ts";

function harness(state: ExecutionState) {
  let dispatchedEvent: ExecuteWorkflowComponentInput | undefined;

  const caller = createHttpProxyCaller({
    workflows: createApiFixture<WorkflowApi>({
      executeComponent: async (input) => {
        dispatchedEvent = input;
        return state;
      },
    }),
    traces: createApiFixture<TraceApi>({ recordCapturedSpan: async () => {} }),
  });

  const dispatchedParameters = (): Record<string, unknown> => {
    if (!dispatchedEvent) throw new Error("component was not dispatched");
    const event = dispatchedEvent;
    const node = event.workflow.nodes.find((candidate) => candidate.id === event.nodeId);
    return Object.fromEntries(
      (node?.data.parameters ?? []).map((parameter) => [parameter.identifier, parameter.value]),
    );
  };

  return {
    caller,
    dispatchedParameters,
    dispatchedInputs: () => dispatchedEvent?.inputs,
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
      });

      const result = await caller.execute(REQUEST);

      expect(result.success).toBe(true);
      expect(dispatchedParameters().url).toBe("https://api.example.com/chat");
    });

    /** @scenario "a template written with spaces around the variable is substituted" */
    it("sends the template and its variables rather than a rendered body", async () => {
      const { caller, dispatchedParameters, dispatchedInputs } = harness({
        status: "success",
        outputs: { output: "hi" },
      });

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
      });

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
      });

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
      });

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
        });

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
      });

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
      });

      const result = await caller.execute(REQUEST);

      expect(result.success).toBe(false);
      expect(result.error).toBe("ssrf_blocked");
    });
  });
});
