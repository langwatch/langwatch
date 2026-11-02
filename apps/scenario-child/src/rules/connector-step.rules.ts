/**
 * A Connector step as the code runner runs it (ADR-194): what it is sent, the one-node workflow
 * that carries it, and what its answer means.
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import { STATE_MAX_BYTES } from "@langwatch/agent-contract";
import type { ConnectorStepData, RunParameterValues } from "@langwatch/scenario-contract";
import { LATEST_SPEC_VERSION } from "@langwatch/workflow-contract";

import type { ScenarioCallRun } from "./scenario-call-run.rules.ts";
import * as ScenarioSecretReferenceAdapter from "./scenario-secret-reference.rules.ts";

export type ConnectorHookKind = "setup" | "teardown";
export type ConnectorObject = Record<string, unknown>;

/** The code node's id; its outputs are the step's answer. */
export const CONNECTOR_STEP_NODE_ID = "connector_step";

/** How much sooner than the hook's budget the code runner stops the code, so it reports why. */
export const CODE_TIMEOUT_HEADROOM_MS = 5_000;

/** The engine's error type for code stopped at its time limit. */
const CODE_BLOCK_TIMEOUT = "code_block_timeout";

/**
 * A step that did not answer with what it must. `agent_call_timeout` is the code the hook service
 * reads as "timed out"; anything else is "failed".
 */
export class ConnectorStepError extends Error {
  readonly code: "agent_call_timeout" | "hook_failed";

  constructor({ message, isTimeout = false }: { message: string; isTimeout?: boolean }) {
    super(message);
    this.name = "ConnectorStepError";
    this.code = isTimeout ? "agent_call_timeout" : "hook_failed";
  }
}

/** The error a step that ran out of its budget records, in whole seconds. */
export function connectorTimeoutMessage({
  kind,
  timeoutMs,
}: {
  kind: ConnectorHookKind;
  timeoutMs: number;
}): string {
  return `The ${kind} step did not finish within ${Math.round(timeoutMs / 1000)} s.`;
}

/**
 * `<scenarioRunId>:<attemptId>:<kind>`, or `<attemptId>:<kind>` outside a run. The job queue
 * delivers at least once, so a re-executed run gets a new attempt and a new key.
 */
export function connectorIdempotencyKey({
  run,
  attemptId,
  kind,
}: {
  run: ScenarioCallRun;
  attemptId: string;
  kind: ConnectorHookKind;
}): string {
  return [run.scenarioRunId, attemptId, kind].filter(Boolean).join(":");
}

/** Why a step must fail before it runs: a named secret the run lacks, or rows it cannot have. */
export function connectorStepRefusal({
  kind,
  step,
}: {
  kind: ConnectorHookKind;
  step: ConnectorStepData;
}): string | null {
  const missing = step.secretNames.filter((name) => !Object.hasOwn(step.secrets, name));
  if (missing.length > 0) {
    return `The ${kind} step names project secrets that do not exist: ${missing.join(", ")}.`;
  }
  return step.rowsRefusal ?? null;
}

/** What the step's code is called with. Teardown alone gets the state setup returned. */
export function connectorStepInput({
  kind,
  run,
  idempotencyKey,
  params,
  rows,
  state,
}: {
  kind: ConnectorHookKind;
  run: ScenarioCallRun;
  idempotencyKey: string;
  params: RunParameterValues;
  rows: ConnectorObject[] | undefined;
  state: ConnectorObject | null;
}): ConnectorObject {
  return {
    kind,
    run,
    idempotencyKey,
    params,
    ...(rows ? { rows } : {}),
    ...(kind === "teardown" && state ? { state } : {}),
  };
}

/** The code runner's time limit for a step, just under the hook's budget. */
export function connectorCodeTimeoutMs(budgetMs: number): number {
  return Math.max(1_000, budgetMs - CODE_TIMEOUT_HEADROOM_MS);
}

/**
 * The `entry -> code -> end` workflow one step runs as, the shape a code agent's turn uses.
 * The secrets ride `workflow.secrets`, which the engine redacts from what it reports.
 */
export function connectorStepWorkflow({
  workflowId,
  step,
  input,
  params,
  secrets,
  projectApiKey,
  codeTimeoutMs,
}: {
  workflowId: string;
  step: ConnectorStepData;
  input: ConnectorObject;
  params: RunParameterValues;
  secrets: Record<string, string>;
  projectApiKey: string;
  codeTimeoutMs: number;
}): Record<string, unknown> {
  const inputField = { identifier: "input", type: "dict" };
  return {
    api_key: projectApiKey,
    workflow_id: workflowId,
    spec_version: LATEST_SPEC_VERSION,
    name: "Scenario Connector step",
    icon: "🔧",
    description: "One Connector setup or teardown step",
    version: "1.0",
    template_adapter: "default",
    secrets,
    params,
    nodes: [
      {
        id: "entry",
        type: "entry",
        position: { x: 0, y: 0 },
        data: {
          name: "Entry",
          outputs: [inputField],
          entry_selection: "first",
          train_size: 1,
          test_size: 1,
          seed: 42,
          dataset: { id: "connector-input", name: "Connector input", inline: null },
        },
      },
      {
        id: CONNECTOR_STEP_NODE_ID,
        type: "code",
        position: { x: 200, y: 0 },
        data: {
          name: "ConnectorStep",
          inputs: [{ ...inputField, value: input }],
          outputs: [],
          parameters: [
            { identifier: "code", type: "code", value: step.code },
            { identifier: "timeout_ms", type: "int", value: codeTimeoutMs },
          ],
          cls: "Code",
        },
      },
      { id: "end", type: "end", position: { x: 400, y: 0 }, data: { name: "End", inputs: [] } },
    ],
    edges: [
      {
        id: `entry-${CONNECTOR_STEP_NODE_ID}-input`,
        source: "entry",
        sourceHandle: "outputs.input",
        target: CONNECTOR_STEP_NODE_ID,
        targetHandle: "inputs.input",
        type: "default",
      },
    ],
    state: { execution: { status: "idle" } },
  };
}

type EngineError = { type?: string; message?: string; traceback?: string };
type EngineAnswer = {
  status?: string;
  error?: EngineError;
  nodes?: Record<string, { outputs?: unknown; error?: EngineError } | null>;
};

function isObject(value: unknown): value is ConnectorObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** The step's outputs from the engine's answer. @throws ConnectorStepError when it failed. */
export function connectorStepOutputs({
  kind,
  rawBody,
}: {
  kind: ConnectorHookKind;
  rawBody: string;
}): ConnectorObject {
  let answer: EngineAnswer;
  try {
    answer = JSON.parse(rawBody) as EngineAnswer;
  } catch {
    throw new ConnectorStepError({ message: `The code runner answered the ${kind} step with no JSON.` });
  }
  if (answer.status === "error") {
    const error = answer.nodes?.[CONNECTOR_STEP_NODE_ID]?.error ?? answer.error;
    const isTimeout = error?.type === CODE_BLOCK_TIMEOUT;
    const detail = error?.traceback || error?.message || error?.type || "no error detail";
    throw new ConnectorStepError({ message: `The ${kind} step failed: ${detail}`, isTimeout });
  }
  const outputs = answer.nodes?.[CONNECTOR_STEP_NODE_ID]?.outputs;
  return isObject(outputs) ? outputs : {};
}

/**
 * What a step answered, checked: setup's `state` (an object, at most 64 KiB) and run-scoped
 * `secrets` (name to string); teardown's whole object, which the run only shows.
 * @throws ConnectorStepError when the answer breaks that shape.
 */
export function connectorStepAnswer({
  kind,
  outputs,
}: {
  kind: ConnectorHookKind;
  outputs: ConnectorObject;
}): { state?: ConnectorObject; secrets?: Record<string, string> } {
  const { state, secrets, ...rest } = outputs;
  if (kind === "teardown") {
    const returned = { ...rest, ...(state === undefined ? {} : { state }) };
    return Object.keys(returned).length > 0 ? { state: returned } : {};
  }
  if (state !== undefined && state !== null && !isObject(state)) {
    throw new ConnectorStepError({ message: "The setup step's state must be a JSON object." });
  }
  if (isObject(state) && byteLength(state) > STATE_MAX_BYTES) {
    throw new ConnectorStepError({
      message: `The setup step's state is over the ${STATE_MAX_BYTES / 1024} KiB a run keeps.`,
    });
  }
  const isSecretMap =
    isObject(secrets) && Object.values(secrets).every((value) => typeof value === "string");
  if (secrets !== undefined && secrets !== null && !isSecretMap) {
    throw new ConnectorStepError({
      message: "The setup step's secrets must map each name to a string.",
    });
  }
  return {
    ...(isObject(state) ? { state } : {}),
    ...(isSecretMap ? { secrets: secrets as Record<string, string> } : {}),
  };
}

/** A JSON value with every known secret value in its strings replaced by the placeholder. */
export function scrubbedJson<T>({ value, secrets }: { value: T; secrets: Record<string, string> }): T {
  if (typeof value === "string") {
    return ScenarioSecretReferenceAdapter.redact({ message: value, secrets }) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => scrubbedJson({ value: item, secrets })) as T;
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, scrubbedJson({ value: item, secrets })]),
    ) as T;
  }
  return value;
}
