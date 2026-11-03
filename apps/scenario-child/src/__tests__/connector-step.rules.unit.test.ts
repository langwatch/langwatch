/**
 * What a Connector step is sent and what its answer means (ADR-194).
 * @vitest-environment node
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import type { ConnectorStepData } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import {
  CONNECTOR_STEP_NODE_ID,
  connectorCodeTimeoutMs,
  connectorIdempotencyKey,
  connectorStepAnswer,
  connectorStepInput,
  connectorStepOutputs,
  connectorStepRefusal,
  connectorStepWorkflow,
  scrubbedJson,
} from "../rules/connector-step.rules.ts";

const step: ConnectorStepData = {
  language: "python",
  code: "def execute(input):\n    return {'state': {'accountId': 'acc_1'}}\n",
  secretNames: ["SHOP_ADMIN_KEY"],
  secrets: { SHOP_ADMIN_KEY: "shop-admin-key-value" },
};
const run = { scenarioRunId: "run_1", scenarioName: "Refund", batchRunId: "batch_1" };

function thrownBy(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

describe("connectorIdempotencyKey()", () => {
  it("names the run, the attempt and the kind", () => {
    expect(connectorIdempotencyKey({ run, attemptId: "att_1", kind: "setup" })).toBe(
      "run_1:att_1:setup",
    );
    expect(connectorIdempotencyKey({ run: {}, attemptId: "att_1", kind: "teardown" })).toBe(
      "att_1:teardown",
    );
  });
});

describe("connectorStepInput()", () => {
  const base = { run, idempotencyKey: "k", params: { persona: "gold" } };

  /** @scenario "A Connector step receives the run, its idempotency key and the run parameters" */
  it("gives setup no state and teardown the state setup returned", () => {
    const state = { accountId: "acc_1" };

    expect(
      connectorStepInput({ ...base, kind: "setup", rows: undefined, state }),
    ).not.toHaveProperty("state");
    expect(
      connectorStepInput({ ...base, kind: "teardown", rows: undefined, state: null }),
    ).toMatchObject({
      state: {},
    });
    expect(connectorStepInput({ ...base, kind: "teardown", rows: undefined, state })).toMatchObject(
      {
        kind: "teardown",
        run,
        params: { persona: "gold" },
        state,
      },
    );
  });

  it("carries the bound rows only when there are some", () => {
    const rows = [{ persona: "gold" }];

    expect(connectorStepInput({ ...base, kind: "setup", rows, state: null })).toMatchObject({
      rows,
    });
    expect(
      connectorStepInput({ ...base, kind: "setup", rows: undefined, state: null }),
    ).not.toHaveProperty("rows");
  });
});

describe("connectorStepRefusal()", () => {
  /** @scenario "A Connector step that names a missing secret fails before it runs" */
  it("names a secret the step needs and the run lacks", () => {
    const refusal = connectorStepRefusal({
      kind: "setup",
      step: { ...step, secretNames: ["SHOP_ADMIN_KEY", "GONE_KEY"] },
    });

    expect(refusal).toContain("GONE_KEY");
    expect(refusal).not.toContain("SHOP_ADMIN_KEY");
  });

  /** @scenario "A Connector step whose dataset is over 64 KiB fails before it runs" */
  it("passes on the prefetch's dataset refusal", () => {
    expect(connectorStepRefusal({ kind: "setup", step: { ...step, refusal: "over 64 KiB" } })).toBe(
      "over 64 KiB",
    );
  });

  it("refuses nothing when every name resolved and the rows are there", () => {
    expect(connectorStepRefusal({ kind: "setup", step })).toBeNull();
  });
});

describe("connectorStepWorkflow()", () => {
  /** @scenario "A Connector step runs only in the code runner" */
  it("carries the step's code as the one code node, with its secrets and a budget under the hook's", () => {
    const workflow = connectorStepWorkflow({
      workflowId: "wf",
      step,
      input: { kind: "setup" },
      params: { persona: "gold" },
      secrets: step.secrets,
      projectApiKey: "sk-lw-run",
      codeTimeoutMs: connectorCodeTimeoutMs(60_000),
    });
    const nodes = workflow.nodes as { id: string; type: string; data: Record<string, unknown> }[];
    const codeNodes = nodes.filter((node) => node.type === "code");

    expect(codeNodes).toHaveLength(1);
    expect(codeNodes[0]?.id).toBe(CONNECTOR_STEP_NODE_ID);
    expect(codeNodes[0]?.data.parameters).toEqual([
      { identifier: "code", type: "code", value: step.code },
      { identifier: "timeout_ms", type: "int", value: 55_000 },
    ]);
    expect(workflow).toMatchObject({
      api_key: "sk-lw-run",
      secrets: { SHOP_ADMIN_KEY: "shop-admin-key-value" },
      params: { persona: "gold" },
    });
  });
});

describe("connectorStepOutputs()", () => {
  it("reads the code node's outputs", () => {
    const rawBody = JSON.stringify({
      status: "success",
      nodes: { [CONNECTOR_STEP_NODE_ID]: { outputs: { state: { a: 1 } } } },
    });

    expect(connectorStepOutputs({ kind: "setup", rawBody })).toEqual({ state: { a: 1 } });
  });

  it("fails with the traceback when the code raised", () => {
    const rawBody = JSON.stringify({
      status: "error",
      error: { type: "code_runner_error", message: "ValueError", traceback: "Traceback: boom" },
    });

    expect(thrownBy(() => connectorStepOutputs({ kind: "setup", rawBody }))).toMatchObject({
      code: "hook_failed",
      message: expect.stringContaining("boom"),
    });
  });

  it("keeps internal addresses out of the error a customer reads", () => {
    const rawBody = JSON.stringify({
      status: "error",
      error: { message: "connect ECONNREFUSED 10.4.2.11:5561 via http://nlpgo:5562/x" },
    });

    const message = (thrownBy(() => connectorStepOutputs({ kind: "setup", rawBody })) as Error)
      .message;

    expect(message).not.toContain("10.4.2.11:5561");
    expect(message).not.toContain("http://nlpgo:5562/");
  });

  it("reads the code runner stopping the code at its limit as a timeout", () => {
    const rawBody = JSON.stringify({ status: "error", error: { type: "code_block_timeout" } });

    expect(thrownBy(() => connectorStepOutputs({ kind: "setup", rawBody }))).toMatchObject({
      code: "agent_call_timeout",
    });
  });
});

describe("connectorStepAnswer()", () => {
  it("keeps setup's state and run-scoped secrets", () => {
    expect(
      connectorStepAnswer({
        kind: "setup",
        outputs: { state: { accountId: "acc_1" }, secrets: { ACCOUNT_TOKEN: "tok" } },
      }),
    ).toEqual({ state: { accountId: "acc_1" }, secrets: { ACCOUNT_TOKEN: "tok" } });
  });

  /** @scenario "A Connector setup state over 64 KiB fails setup" */
  it("fails a setup whose state is over 64 KiB", () => {
    expect(() =>
      connectorStepAnswer({ kind: "setup", outputs: { state: { blob: "x".repeat(64 * 1024) } } }),
    ).toThrow(/64 KiB/);
  });

  /** @scenario "A Connector setup that answers outside the state shape fails setup" */
  it("fails a setup that returns keys other than state and secrets, naming them", () => {
    expect(() => connectorStepAnswer({ kind: "setup", outputs: { accountId: "acc_1" } })).toThrow(
      /\{ state, secrets\? \}.*accountId/,
    );
  });

  it("fails a setup whose state is not an object or whose secrets are not strings", () => {
    expect(() => connectorStepAnswer({ kind: "setup", outputs: { state: [1] } })).toThrow(
      /JSON object/,
    );
    expect(() =>
      connectorStepAnswer({ kind: "setup", outputs: { secrets: { TOKEN: 1 } } }),
    ).toThrow(/map each name to a string/);
  });

  it("returns teardown's whole object, without any secrets it returned", () => {
    expect(
      connectorStepAnswer({ kind: "teardown", outputs: { deleted: 3, secrets: { X: "y" } } }),
    ).toEqual({ state: { deleted: 3 } });
    expect(connectorStepAnswer({ kind: "teardown", outputs: {} })).toEqual({});
  });
});

describe("scrubbedJson()", () => {
  it("replaces every secret value in nested strings", () => {
    expect(
      scrubbedJson({
        value: { token: "tok-123456", nested: ["Bearer tok-123456"], n: 1 },
        values: ["tok-123456"],
      }),
    ).toEqual({ token: "[redacted]", nested: ["Bearer [redacted]"], n: 1 });
  });
});
