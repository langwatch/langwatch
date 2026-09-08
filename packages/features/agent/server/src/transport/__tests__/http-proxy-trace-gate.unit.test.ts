/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import type { TraceApi, RecordCapturedSpanInput } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { createHttpProxyCaller } from "./http-proxy.fixture.ts";
import { z } from "zod";

type Recorded = RecordCapturedSpanInput;

function harness() {
  const dispatched: Array<{ projectId: string; headers: Record<string, string> }> = [];
  const recorded: Recorded[] = [];

  const caller = createHttpProxyCaller({
    workflows: createApiFixture<WorkflowApi>({
      executeComponent: async ({ projectId, workflow }) => {
        const node = workflow.nodes[0];
        const headerParameter = node?.data.parameters?.find(
          ({ identifier }) => identifier === "headers",
        );

        dispatched.push({
          projectId,
          headers: z.record(z.string(), z.string()).parse(headerParameter?.value ?? {}),
        });

        return {
          status: "success",
          outputs: { output: "answered" },
          http: { status_code: 200, status_text: "OK" },
          timestamps: { started_at: 1_000, finished_at: 1_250 },
        };
      },
    }),
    traces: createApiFixture<TraceApi>({
      recordCapturedSpan: async (input) => {
        recorded.push(input);
      },
    }),
  });

  return { caller, dispatched, recorded };
}

const REQUEST = {
  projectId: "project_1",
  url: "https://agent.test/answer",
  method: "POST" as const,
  bodyTemplate: '{"question":"hi"}',
};

describe("httpProxy.execute", () => {
  describe("given an agent that has been saved and carries an agentId", () => {
    describe("when the user executes a test request", () => {
      /** @scenario "Successful request creates a trace" */
      /** @scenario "Trace includes project ID" */
      it("records the trace against the project the test ran in", async () => {
        const { caller, recorded } = harness();

        await caller.execute({ ...REQUEST, agentId: "agent_1" });

        expect(recorded).toHaveLength(1);
        expect(recorded[0]!.projectId).toBe("project_1");
        expect(recorded[0]!.customMetadata).toMatchObject({ agent_id: "agent_1" });
        expect(recorded[0]!.userId).toBe("user_1");
        expect(recorded[0]!.span.output).toMatchObject({ value: { status: 200 } });
      });

      /**
       * The Traces page reads this type: a trace recorded without it is filed
       * as ordinary traffic and the agent's test history never lists it.
       */
      /** @scenario "Test execution creates a trace visible on the Traces page" */
      it("files exactly one trace, typed as an agent test", async () => {
        const { caller, recorded } = harness();

        await caller.execute({ ...REQUEST, agentId: "agent_1" });

        expect(recorded).toHaveLength(1);
        expect(recorded[0]!.customMetadata).toMatchObject({ type: "agent_test" });
        expect(recorded[0]!.span.trace_id).toMatch(/^[0-9a-f]{32}$/);
      });

      /** @scenario "Traceparent header enables distributed tracing" */
      it("sends a W3C traceparent naming the trace it goes on to record", async () => {
        const { caller, dispatched, recorded } = harness();

        await caller.execute({ ...REQUEST, agentId: "agent_1" });

        const traceparent = dispatched[0]!.headers.traceparent;
        expect(traceparent).toBeDefined();
        const trace = recorded[0]!;
        expect(traceparent).toBe(`00-${trace.span.trace_id}-${trace.span.span_id}-01`);
        expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
      });
    });
  });

  describe("given an agent that has no agentId yet", () => {
    describe("when the user executes a test request", () => {
      /** @scenario "No trace without agentId" */
      it("submits no trace", async () => {
        const { caller, recorded } = harness();

        const result = await caller.execute(REQUEST);

        expect(result.success).toBe(true);
        expect(recorded).toEqual([]);
      });

      /** @scenario "No traceparent without agentId" */
      it("sends no traceparent header on the outgoing request", async () => {
        const { caller, dispatched } = harness();

        await caller.execute(REQUEST);

        expect(dispatched).toHaveLength(1);
        expect(Object.keys(dispatched[0]!.headers)).not.toContain("traceparent");
      });
    });
  });
});
