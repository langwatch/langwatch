/**
 * @vitest-environment node
 *
 * The agentId gate. A test run from an unsaved agent has nothing to attach a
 * trace to, so the transport must neither record a span nor push a traceparent
 * onto the outgoing request — otherwise the customer's own service correlates
 * against a trace that was never written.
 */
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";
import type { AgentTestTrace } from "../agent-test-tracing";
import { HttpProxyTrpcApi } from "../http-proxy.api";

type Recorded = { projectId: string; trace: AgentTestTrace };

function harness() {
  const dispatched: Array<{ projectId: string; headers: Record<string, string> }> = [];
  const recorded: Recorded[] = [];

  const trpc = initTRPC.context<{ actor(): { id: string } }>().create();
  const router = HttpProxyTrpcApi.create(
    trpc,
    {
      protected: trpc.procedure,
      policy: () => (procedure) => procedure,
    },
    {
      postStudioEvent: async (_request, { projectId, event, onEvent }) => {
        const node = (event as { payload: { workflow: { nodes: Array<Record<string, any>> } } })
          .payload.workflow.nodes[0]!;
        const headerParameter = (
          node.data.parameters as Array<{ identifier: string; value: unknown }>
        ).find(({ identifier }) => identifier === "headers");

        dispatched.push({
          projectId,
          headers: (headerParameter?.value ?? {}) as Record<string, string>,
        });

        onEvent({
          type: "component_state_change",
          payload: {
            component_id: "http_agent_test",
            execution_state: {
              status: "success",
              outputs: { output: "answered" },
              http: { status_code: 200, status_text: "OK" },
              timestamps: { started_at: 1_000, finished_at: 1_250 },
            },
          },
        } as never);
      },
      recordAgentTestTrace: async (_request, input) => {
        recorded.push(input as Recorded);
      },
    },
  );

  const caller = trpc.createCallerFactory(router)({ actor: () => ({ id: "user_1" }) });

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
      it("records the trace against the project the test ran in", async () => {
        const { caller, recorded } = harness();

        await caller.execute({ ...REQUEST, agentId: "agent_1" });

        expect(recorded).toHaveLength(1);
        expect(recorded[0]!.projectId).toBe("project_1");
        expect(recorded[0]!.trace.customMetadata).toMatchObject({ agent_id: "agent_1" });
        expect(recorded[0]!.trace.userId).toBe("user_1");
        expect(recorded[0]!.trace.span.output).toMatchObject({ value: { status: 200 } });
      });

      /** @scenario "Traceparent header enables distributed tracing" */
      it("sends a W3C traceparent naming the trace it goes on to record", async () => {
        const { caller, dispatched, recorded } = harness();

        await caller.execute({ ...REQUEST, agentId: "agent_1" });

        const traceparent = dispatched[0]!.headers.traceparent;
        expect(traceparent).toBeDefined();
        const trace = recorded[0]!.trace;
        expect(traceparent).toBe(`00-${trace.traceId}-${trace.span.span_id}-01`);
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
