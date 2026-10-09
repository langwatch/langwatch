/**
 * @vitest-environment node
 *
 * @see specs/model-providers/doubleword-provider.feature
 *
 * A consumer that rethrows a node failure from inside onEvent lands in the
 * stream's own catch, which re-emits the failure as a component state. That
 * re-emitted state must keep the provider's HTTP status, or the playground
 * can no longer tell an out-of-credit account from a bad key.
 */
import { describe, expect, it, vi } from "vitest";

import type { StudioClientEvent } from "../../../../../optimization_studio/types/events";

vi.mock("../../../../../optimization_studio/server/addEnvs", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../../optimization_studio/server/addEnvs")
  >("../../../../../optimization_studio/server/addEnvs");
  return { ...actual, getS3CacheKey: () => undefined };
});

const failedNodeFrame = {
  type: "component_state_change",
  payload: {
    component_id: "prompt_node",
    execution_state: {
      status: "error",
      error: "gateway returned non-2xx status 402",
      upstream_status: 402,
    },
  },
};

vi.mock("../../../../../optimization_studio/server/lambda", () => ({
  invokeLambda: vi.fn(async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            `data: ${JSON.stringify(failedNodeFrame)}\n\n`,
          ),
        );
        controller.close();
      },
    });
    return stream.getReader();
  }),
}));

const promptCall = {
  type: "execute_component",
  payload: { trace_id: "t", node_id: "prompt_node", inputs: {} },
} as unknown as StudioClientEvent;

describe("studioBackendPostEvent", () => {
  describe("when the consumer rethrows a node failure that carries an upstream status", () => {
    /** @scenario A provider account with no credit left is named in the playground */
    it("re-emits the failure with the same upstream status", async () => {
      const seen: unknown[] = [];
      const onEvent = vi.fn((event: any) => {
        seen.push(event);
        const state = event.payload?.execution_state;
        if (seen.length === 1 && state?.error) {
          throw Object.assign(new Error(state.error), {
            upstreamStatus: state.upstream_status,
          });
        }
      });

      const { studioBackendPostEvent } = await import("../post-event");
      await studioBackendPostEvent({
        projectId: "p",
        message: promptCall,
        onEvent,
      });

      expect(onEvent).toHaveBeenCalledTimes(2);
      expect(seen[1]).toMatchObject({
        type: "component_state_change",
        payload: {
          component_id: "prompt_node",
          execution_state: { status: "error", upstream_status: 402 },
        },
      });
    });
  });
});
