/**
 * End-to-end test for BUG B3 — eval-v3's TargetCell missing trace_id.
 *
 *   [test]
 *     │ POST /go/studio/execute (SSE) with an execute_component event
 *     │ carrying a known trace_id
 *     ▼
 *   [real nlpgo subprocess (prebuilt binary, _nlpgoSubprocess.ts)]
 *     │ Server-Sent Events stream
 *     ▼
 *   [test parses `component_state_change` frames]
 *
 * Asserts (against the SSE frames nlpgo actually emits):
 *   Every `component_state_change` event carries
 *   `payload.execution_state.trace_id` === the inbound trace_id.
 *
 * Why this is the right proof: eval-v3's TargetCell reads the per-row
 * trace id EXCLUSIVELY from `execution_state.trace_id`
 * (resultMapper.ts:306). The eval-v3 orchestrator generates the
 * trace_id and sends it INTO nlpgo as the request trace_id; nlpgo must
 * echo it back inside execution_state or the cell's `traceId` resolves
 * to undefined and the "View trace" link never renders — exactly the
 * 2026-05-15 dogfood symptom. Python's start/end/error component events
 * all set ExecutionState.trace_id (langwatch_nlp/studio/types/events.py
 * :216,250,269); the Go port had dropped that field, carrying the id
 * only on the (for this event type, unused) outer envelope.
 *
 * Unlike the traceparent-roundtrip test this needs no ClickHouse / Redis
 * / OTLP pipeline — the regression is purely in what nlpgo streams back,
 * so we assert directly on the wire frames. Gate is therefore just `go`.
 *
 * Subprocess boot + SSE parsing are shared via _nlpgoSubprocess.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  collectSSE,
  hasGo,
  startNlpgoSubprocess,
  type NlpgoSubprocess,
} from "./_nlpgoSubprocess";

// Unique port alongside the other nlpgo subprocess integration tests
// (55610 / 55611 / 55612 / 55620 — see CLAUDE.md). 55613 is this test's.
const NLPGO_PORT = 55613;
const KNOWN_TRACE_ID = "b3eval0123456789b3eval0123456789";

describe.skipIf(!hasGo())(
  "nlpgo eval-v3 — component_state_change carries trace_id in execution_state (B3)",
  () => {
    let nlpgo: NlpgoSubprocess;

    beforeAll(async () => {
      nlpgo = await startNlpgoSubprocess({ port: NLPGO_PORT });
    }, 700_000); // cold go build budget + boot + health

    afterAll(async () => {
      await nlpgo?.stop();
    });

    // execute_component is exactly what the eval-v3 orchestrator sends
    // per dataset cell (orchestrator.ts:290/386). Entry → End is a
    // dependency-free path (no LLM, no evaluator HTTP) that still emits
    // per-node component_state_change events — the minimal faithful
    // repro of the round-trip the TargetCell depends on.
    function makeExecuteComponentBody(traceId: string) {
      return {
        type: "execute_component",
        payload: {
          trace_id: traceId,
          node_id: "end",
          workflow: {
            workflow_id: "wf_b3",
            api_key: "test-key-b3-eval-trace",
            spec_version: "1.3",
            name: "B3 eval trace",
            icon: "x",
            description: "x",
            version: "x",
            template_adapter: "default",
            nodes: [
              {
                id: "entry",
                type: "entry",
                data: {
                  outputs: [{ identifier: "input", type: "str" }],
                },
              },
              { id: "end", type: "end", data: {} },
            ],
            edges: [
              {
                id: "e1",
                source: "entry",
                sourceHandle: "outputs.input",
                target: "end",
                targetHandle: "inputs.output",
                type: "default",
              },
            ],
            state: {},
          },
          inputs: { input: "hello" },
          manual_execution_mode: false,
          do_not_trace: false,
        },
      };
    }

    it(
      "every component_state_change frame echoes the inbound trace_id inside execution_state",
      async () => {
        const body = makeExecuteComponentBody(KNOWN_TRACE_ID);
        const resp = await fetch(`${nlpgo.baseUrl}/go/studio/execute`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "X-LangWatch-Origin": "evaluation",
          },
          body: JSON.stringify(body),
        });
        expect(
          resp.ok,
          `nlpgo /go/studio/execute responded ${resp.status}`,
        ).toBe(true);

        const frames = await collectSSE(resp.body, { timeoutMs: 30_000 });
        const componentEvents = frames.filter(
          (f) => f.type === "component_state_change",
        );

        // The execute_component path must emit per-node state events —
        // without them the eval-v3 result cell has nothing to populate.
        expect(
          componentEvents.length,
          "nlpgo emitted no component_state_change frames for the " +
            "execute_component request",
        ).toBeGreaterThan(0);

        // CORE ASSERTION — the field eval-v3's TargetCell reads
        // (execution_state.trace_id, resultMapper.ts:306) is present
        // and equals the trace_id the orchestrator sent in. Pre-fix it
        // was absent (carried only on the unused outer envelope), so
        // the cell's trace link never rendered.
        for (const ev of componentEvents) {
          const es = ev?.payload?.execution_state;
          expect(
            es,
            `component_state_change missing execution_state: ${JSON.stringify(ev)}`,
          ).toBeTruthy();
          expect(
            es.trace_id,
            `component_state_change.execution_state.trace_id missing/blank ` +
              `(status=${es?.status}) — eval-v3 TargetCell would render no ` +
              `"View trace" link. Frame: ${JSON.stringify(ev)}`,
          ).toBe(KNOWN_TRACE_ID);
        }
      },
      60_000,
    );
  },
);
