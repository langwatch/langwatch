import type { Mock } from "vitest";

const AGENT_TEST_NODE_ID = "http_agent_test";

/**
 * Stands in for the engine, replying to a dispatch with the state it finished
 * the node in.
 *
 * This encodes the contract the router reads: a `component_state_change` for
 * the node it dispatched, carrying an `execution_state`. It lives here rather
 * than in each test file so a change to that shape cannot leave one suite
 * passing against a payload the engine no longer sends. The post-event mock is
 * a parameter because `vi.mock` is per file, so each suite owns its own.
 */
export const engineRepliesWith =
  (postEvent: Mock) => (executionState: Record<string, unknown>) => {
    postEvent.mockImplementation(
      async ({ onEvent }: { onEvent: (event: unknown) => void }) => {
        onEvent({
          type: "component_state_change",
          payload: {
            component_id: AGENT_TEST_NODE_ID,
            execution_state: executionState,
          },
        });
      },
    );
  };
