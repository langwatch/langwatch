/**
 * The code each block starts with, naming what the block is sent and what it must return.
 * @see apps/scenario-child/src/rules/connector-block.rules.ts (connectorBlockInput and the answers)
 */

import type { PythonField } from "../../../model/workflow/code/python-provider.shared.ts";

export type ConnectorBlockKind = "setup" | "call" | "teardown";

export const CALL_STARTER = `class Code:
    def __call__(self, input: dict):
        # input["message"]: the user's message this turn
        # input["history"]: the earlier messages, each {"role": ..., "content": ...}
        # input["state"]: what setup returned; input["rows"]: the fixtures dataset's rows
        # input["idempotencyKey"]: send it so a retried turn is not applied twice
        # A secret this agent names reads as secrets.NAME
        return {"reply": f"You said: {input['message']}"}
`;

export const SETUP_STARTER = `class Code:
    def __call__(self, input: dict):
        # Make the test data this run needs, for example an account in your API.
        # input["rows"]: the fixtures dataset's rows; input["params"]: the run's parameters
        # Return the state the call and teardown blocks get, and optional run-scoped secrets.
        return {"state": {"accountId": "acc_1"}}
`;

export const TEARDOWN_STARTER = `class Code:
    def __call__(self, input: dict):
        # Remove what setup made; input["state"] is what setup returned.
        return {}
`;

export const STARTER_BY_KIND: Record<ConnectorBlockKind, string> = {
  call: CALL_STARTER,
  setup: SETUP_STARTER,
  teardown: TEARDOWN_STARTER,
};

/** Every block is called with one `input` dict. */
export const BLOCK_INPUTS: readonly PythonField[] = [{ identifier: "input", type: "dict" }];

/** The keys the code editor warns about when a block's return leaves them out. */
export const BLOCK_OUTPUTS_BY_KIND: Record<ConnectorBlockKind, readonly PythonField[]> = {
  call: [{ identifier: "reply", type: "str" }],
  setup: [{ identifier: "state", type: "dict" }],
  teardown: [],
};
