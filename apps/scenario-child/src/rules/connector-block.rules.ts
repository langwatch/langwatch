/**
 * A Scenario Connector block as the code runner runs it (ADR-194): what it is sent, the one-node
 * workflow that carries it, and what its answer means.
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import { CONNECTOR_SECRET_NAME_PATTERN, STATE_MAX_BYTES } from "@langwatch/agent-contract";
import type { ConnectorBlockData, RunParameterValues } from "@langwatch/scenario-contract";
import { LATEST_SPEC_VERSION } from "@langwatch/workflow-contract";

import * as ScenarioSecretReferenceAdapter from "./scenario-secret-reference.rules.ts";

export type ConnectorBlockKind = "setup" | "call" | "teardown";
export type ConnectorObject = Record<string, unknown>;

/** The scenario run every block names; each id is absent outside a scenario run. */
export interface ConnectorRun {
  scenarioRunId?: string;
  scenarioName?: string;
  batchRunId?: string;
}

/** The code node's id; its outputs are the block's answer. */
export const CONNECTOR_BLOCK_NODE_ID = "connector_block";

/** How much sooner than its budget the code runner stops a block, so it reports why. */
export const CODE_TIMEOUT_HEADROOM_MS = 5_000;

/** The engine's error type for code stopped at its time limit. */
const CODE_BLOCK_TIMEOUT = "code_block_timeout";

/**
 * How the hook service records a block error: `agent_call_timeout` as "timed out", `hook_refused`
 * (a teardown on a connector refused before any block ran) as "not run" and refused, `hook_failed`
 * as "failed".
 */
export type ConnectorBlockErrorCode = "agent_call_timeout" | "hook_refused" | "hook_failed";

/** A block that did not answer with what it must, or that was never run. */
export class ConnectorBlockError extends Error {
  readonly code: ConnectorBlockErrorCode;

  constructor({
    message,
    code = "hook_failed",
  }: {
    message: string;
    code?: ConnectorBlockErrorCode;
  }) {
    super(message);
    this.name = "ConnectorBlockError";
    this.code = code;
  }
}

/** The error a block that ran out of its budget records, in whole seconds. */
export function connectorTimeoutMessage({
  kind,
  timeoutMs,
}: {
  kind: ConnectorBlockKind;
  timeoutMs: number;
}): string {
  return `The ${kind} block did not finish within ${Math.round(timeoutMs / 1000)} s.`;
}

/**
 * `<scenarioRunId>:<attemptId>:<kind>`, or `<attemptId>:<kind>` outside a run; a call block adds
 * `:<turn>` so each turn is its own request. The job queue delivers at least once, so a
 * re-executed run gets a new attempt and a new key.
 */
export function connectorIdempotencyKey({
  run,
  attemptId,
  kind,
  turn,
}: {
  run: ConnectorRun;
  attemptId: string;
  kind: ConnectorBlockKind;
  /** Zero-based turn index; set for `call` only. */
  turn?: number;
}): string {
  return [run.scenarioRunId, attemptId, kind, turn?.toString()].filter(Boolean).join(":");
}

/** One message of the conversation as a call block receives it. */
export type ConnectorMessage = { role: string; content: unknown };

/** What a block's code is called with. Setup gets no state; call and teardown get setup's. */
export function connectorBlockInput({
  kind,
  run,
  idempotencyKey,
  params,
  rows,
  state,
  turn,
}: {
  kind: ConnectorBlockKind;
  run: ConnectorRun;
  idempotencyKey: string;
  params: RunParameterValues;
  rows: ConnectorObject[] | undefined;
  state: ConnectorObject | null;
  turn?: { message: string; history: ConnectorMessage[] };
}): ConnectorObject {
  return {
    kind,
    run,
    idempotencyKey,
    params,
    ...(rows ? { rows } : {}),
    ...(kind === "setup" ? {} : { state: state ?? {} }),
    ...(turn ? { message: turn.message, history: turn.history } : {}),
  };
}

/** The code runner's time limit for a block, just under its budget. */
export function connectorCodeTimeoutMs(budgetMs: number): number {
  return Math.max(1_000, budgetMs - CODE_TIMEOUT_HEADROOM_MS);
}

/**
 * The `entry -> code -> end` workflow one block runs as, the shape a code agent's turn uses.
 * The secrets ride `workflow.secrets`, which the engine redacts from what it reports.
 */
export function connectorBlockWorkflow({
  workflowId,
  block,
  input,
  params,
  secrets,
  projectApiKey,
  codeTimeoutMs,
}: {
  workflowId: string;
  block: ConnectorBlockData;
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
    name: "Scenario Connector block",
    icon: "🔧",
    description: "One Scenario Connector setup, call or teardown block",
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
        id: CONNECTOR_BLOCK_NODE_ID,
        type: "code",
        position: { x: 200, y: 0 },
        data: {
          name: "ConnectorBlock",
          inputs: [{ ...inputField, value: input }],
          outputs: [],
          parameters: [
            { identifier: "code", type: "code", value: block.code },
            { identifier: "timeout_ms", type: "int", value: codeTimeoutMs },
          ],
          cls: "Code",
        },
      },
      { id: "end", type: "end", position: { x: 400, y: 0 }, data: { name: "End", inputs: [] } },
    ],
    edges: [
      {
        id: `entry-${CONNECTOR_BLOCK_NODE_ID}-input`,
        source: "entry",
        sourceHandle: "outputs.input",
        target: CONNECTOR_BLOCK_NODE_ID,
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
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/**
 * The block's outputs from the engine's answer.
 * @throws ConnectorBlockError when it failed, its detail uncut so it is scrubbed before it is cut.
 */
export function connectorBlockOutputs({
  kind,
  rawBody,
}: {
  kind: ConnectorBlockKind;
  rawBody: string;
}): ConnectorObject {
  let answer: EngineAnswer;
  try {
    answer = JSON.parse(rawBody) as EngineAnswer;
  } catch {
    throw new ConnectorBlockError({
      message: `The code runner answered the ${kind} block with no JSON.`,
    });
  }
  if (answer.status === "error") {
    const error = answer.nodes?.[CONNECTOR_BLOCK_NODE_ID]?.error ?? answer.error;
    const code = error?.type === CODE_BLOCK_TIMEOUT ? "agent_call_timeout" : "hook_failed";
    const rawDetail = error?.traceback || error?.message || error?.type || "no error detail";
    // Left raw: the service scrubs secrets first, then strips noise and redacts addresses.
    throw new ConnectorBlockError({ message: `The ${kind} block failed: ${rawDetail}`, code });
  }
  const outputs = answer.nodes?.[CONNECTOR_BLOCK_NODE_ID]?.outputs;
  return isObject(outputs) ? outputs : {};
}

/** Setup's answer: what teardown can still use, and why setup fails when it breaks its shape. */
export type ConnectorSetupAnswer = {
  /** The state when it is an object, kept even over the cap so teardown can clean up. */
  state?: ConnectorObject;
  /** The run-scoped secrets with a valid name that no project secret already holds. */
  secrets: Record<string, string>;
  /** Every string secret value setup returned, usable or not, to scrub from what is shown. */
  secretValues: string[];
  /** Set when setup must fail; names no secret value. */
  problem?: string;
};

/**
 * Setup's answer, checked: `state` (an object, at most 64 KiB) and run-scoped `secrets` (a valid
 * name, not a project secret's, to a string), nothing else. Never throws: the usable part is kept
 * beside the first problem, so a failed setup's data can still be torn down.
 */
export function connectorSetupAnswer({
  outputs,
  projectSecretNames,
}: {
  outputs: ConnectorObject;
  projectSecretNames: readonly string[];
}): ConnectorSetupAnswer {
  const { state, secrets, ...rest } = outputs;
  const entries = isObject(secrets) ? Object.entries(secrets) : [];
  const named = entries.filter((entry): entry is [string, string] => typeof entry[1] === "string");
  const names = named.map(([name]) => name);
  const badNames = names.filter((name) => !CONNECTOR_SECRET_NAME_PATTERN.test(name));
  const clashes = names.filter((name) => projectSecretNames.includes(name));
  const isSecretMap =
    secrets === undefined ||
    secrets === null ||
    (isObject(secrets) && named.length === entries.length);
  const problem = setupProblem({
    unknownKeys: Object.keys(rest),
    state,
    isSecretMap,
    badNames,
    clashes,
  });
  return {
    ...(isObject(state) ? { state } : {}),
    secrets: Object.fromEntries(
      named.filter(([name]) => !badNames.includes(name) && !clashes.includes(name)),
    ),
    secretValues: named.map(([, value]) => value),
    ...(problem ? { problem } : {}),
  };
}

/** The first way setup's answer breaks its shape, naming keys and secret names, never values. */
function setupProblem({
  unknownKeys,
  state,
  isSecretMap,
  badNames,
  clashes,
}: {
  unknownKeys: string[];
  state: unknown;
  isSecretMap: boolean;
  badNames: string[];
  clashes: string[];
}): string | undefined {
  // A bare `{"accountId": ...}` would otherwise record ok with an empty state.
  if (unknownKeys.length > 0) {
    return `The setup block must return { state, secrets? }; it also returned: ${unknownKeys.join(", ")}.`;
  }
  if (state !== undefined && state !== null && !isObject(state)) {
    return "The setup block's state must be a JSON object.";
  }
  if (isObject(state) && byteLength(state) > STATE_MAX_BYTES) {
    return `The setup block's state is over the ${STATE_MAX_BYTES / 1024} KiB a run keeps.`;
  }
  if (!isSecretMap) return "The setup block's secrets must map each name to a string.";
  if (badNames.length > 0) {
    return `Setup returned the secret name ${badNames.join(", ")}, which must be capital letters, digits and underscores, starting with a letter.`;
  }
  if (clashes.length > 0) {
    return `Setup returned secret ${clashes.join(", ")}, which is already a project secret.`;
  }
  return undefined;
}

/** The call block's reply text. @throws ConnectorBlockError without a `reply`. */
export function connectorCallReply(outputs: ConnectorObject): string {
  const { reply } = outputs;
  if (reply === undefined || reply === null) {
    throw new ConnectorBlockError({ message: "The call block must return { reply }." });
  }
  return typeof reply === "string" ? reply : JSON.stringify(reply);
}

/** Teardown's whole answer, which the run only shows. */
export function connectorTeardownAnswer(outputs: ConnectorObject): { state?: ConnectorObject } {
  return Object.keys(outputs).length > 0 ? { state: outputs } : {};
}

/** Each secret as written, base64 (standard and URL-safe, padded or not) and URL-encoded. */
export function secretVariants(values: readonly string[]): string[] {
  const variants = new Set<string>();
  for (const value of values) {
    if (value === "") continue;
    const base64 = Buffer.from(value).toString("base64");
    const urlSafe = base64.replaceAll("+", "-").replaceAll("/", "_");
    for (const form of [value, base64, urlSafe, encodeURIComponent(value)]) {
      variants.add(form);
      variants.add(form.replace(/=+$/, ""));
    }
  }
  return [...variants];
}

/** Text with every known secret value, and its encoded forms, replaced, longest first. */
export function scrubbedText({
  text,
  values,
}: {
  text: string;
  values: readonly string[];
}): string {
  const secrets = Object.fromEntries(
    secretVariants(values).map((value, index) => [String(index), value]),
  );
  return ScenarioSecretReferenceAdapter.redact({ message: text, secrets });
}

/** A JSON value with every secret value in its strings and keys replaced by the placeholder. */
export function scrubbedJson<T>({ value, values }: { value: T; values: readonly string[] }): T {
  const variants = secretVariants(values);
  const scrub = (item: unknown): unknown => {
    if (typeof item === "string") return scrubbedText({ text: item, values: variants });
    if (Array.isArray(item)) return item.map(scrub);
    if (isObject(item)) {
      return Object.fromEntries(
        Object.entries(item).map(([key, inner]) => [
          scrubbedText({ text: key, values: variants }),
          scrub(inner),
        ]),
      );
    }
    return item;
  };
  return scrub(value) as T;
}
