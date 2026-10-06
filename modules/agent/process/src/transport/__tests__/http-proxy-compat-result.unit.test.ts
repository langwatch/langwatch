import { httpProxyResultSchema } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type {
  WorkflowApi,
  ExecuteWorkflowComponentInput,
  ExecutionState,
} from "@langwatch/workflow-contract";
/**
 * @vitest-environment node
 * @see modules/agent/specs/package-boundary.feature
 */
import { describe, expect, it } from "vitest";

import { createHttpProxyCaller } from "./http-proxy.fixture.ts";

function harness(state: ExecutionState) {
  let dispatched: ExecuteWorkflowComponentInput | undefined;
  const caller = createHttpProxyCaller({
    workflows: createApiFixture<WorkflowApi>({
      executeComponent: async (input) => {
        dispatched = input;
        return state;
      },
    }),
    traces: createApiFixture<TraceApi>({ recordCapturedSpan: async () => {} }),
  });

  return { caller, dispatched: () => dispatched };
}

const REQUEST = {
  projectId: "project_1",
  url: "https://api.example.com/chat",
  method: "POST" as const,
  headers: [{ key: "X-Team", value: "blue" }],
  bodyTemplate: '{"q": "{{ input }}"}',
  templateVariables: { input: "hello" },
};

describe("HTTP request testing result", () => {
  describe("when the user tests the request and the call succeeds", () => {
    /** @scenario "HTTP request testing preserves the compatibility result" */
    it("executes it for the current project and answers every established result field", async () => {
      const { caller, dispatched } = harness({
        status: "success",
        outputs: { output: "the answer" },
        timestamps: { started_at: 1_000, finished_at: 1_250 },
        http: {
          status_code: 200,
          status_text: "OK",
          response_headers: { "Content-Type": "application/json" },
          rendered_body: '{"q": "hello"}',
          warnings: ["template variable not found: question"],
        },
      });

      const result = await caller.execute(REQUEST);

      expect(dispatched()?.projectId).toBe("project_1");
      expect(dispatched()?.origin).toBe("agent_test");
      expect(result).toEqual({
        success: true,
        response: "the answer",
        extractedOutput: "the answer",
        status: 200,
        statusText: "OK",
        duration: 250,
        responseHeaders: { "Content-Type": "application/json" },
        renderedBody: '{"q": "hello"}',
        warnings: ["template variable not found: question"],
      });
      expect(httpProxyResultSchema.validate(result)).toBe(true);
    });

    /** @scenario "HTTP request testing preserves the compatibility result" */
    it("sends only header keys and values across the boundary", async () => {
      const { caller, dispatched } = harness({ status: "success", outputs: { output: "hi" } });

      await caller.execute(REQUEST);

      const node = dispatched()?.workflow.nodes.find(({ id }) => id === dispatched()?.nodeId);
      const headers = node?.data.parameters?.find(({ identifier }) => identifier === "headers");

      expect(headers?.value).toEqual({ "X-Team": "blue" });
    });
  });

  describe("when the engine reports a failed call", () => {
    /** @scenario "HTTP request testing preserves the compatibility result" */
    it("answers the error, its code and the status the upstream gave", async () => {
      const { caller } = harness({
        status: "error",
        error: "Upstream refused the request",
        error_type: "http_status_error",
        http: { status_code: 502 },
        timestamps: { started_at: 10, finished_at: 40 },
      });

      const result = await caller.execute(REQUEST);

      expect(result).toMatchObject({
        success: false,
        error: "Upstream refused the request",
        errorCode: "http_status_error",
        status: 502,
        duration: 30,
      });
    });
  });
});
