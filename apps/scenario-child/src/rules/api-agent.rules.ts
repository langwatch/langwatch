/**
 * The code an API agent's slots become in the nlpgo sandbox, and what its answers mean. The slots
 * are the customer's `turn`, `setup` and `teardown` functions; a generated `Code` class routes one
 * call to one of them, so the sandbox, its secrets and its timeout are the code agent's own.
 * @see modules/scenario/specs/scenario-run-hooks.feature
 */

import { STATE_MAX_BYTES } from "@langwatch/agent-contract";
import type { ApiAgentData } from "@langwatch/scenario-contract";

import { HttpHookError, type HttpHookKind, type HttpHookObject } from "./http-hook.rules.ts";

export type ApiCallKind = "turn" | HttpHookKind;

/** The names the generated `Code` reads the agent's address and key under, in `secrets`. */
export const API_BASE_URL_SECRET = "LW_API_BASE_URL";
export const API_KEY_SECRET = "LW_API_KEY";

// Underscore-prefixed imports keep the customer's own names (json, requests) untouched.
const DISPATCHER = `
import json as _lw_json
from types import SimpleNamespace as _LwNamespace


class Code:
    def __call__(self, call_kind, payload):
        data = _lw_json.loads(payload)
        api = _LwNamespace(
            base_url=getattr(secrets, "${API_BASE_URL_SECRET}"),
            api_key=getattr(secrets, "${API_KEY_SECRET}", None),
        )
        if call_kind == "turn":
            reply = turn(api, data["message"], data["history"], data["state"])
            return {"output": reply if isinstance(reply, str) else _lw_json.dumps(reply)}
        if call_kind == "setup":
            return {"output": _lw_json.dumps(setup(api, data["params"]))}
        if call_kind == "teardown":
            return {"output": _lw_json.dumps(teardown(api, data["state"], data["params"]))}
        raise ValueError("unknown call kind: " + str(call_kind))
`;

/** The slots followed by the class that routes a call to one of them. */
export function apiAgentSource(data: Pick<ApiAgentData, "turn" | "setup" | "teardown">): string {
  return [data.turn, data.setup, data.teardown, DISPATCHER]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

/** The secrets the sandbox sees: the project's, plus the agent's address and its resolved key. */
export function apiAgentSecrets({
  data,
  apiKey,
}: {
  data: Pick<ApiAgentData, "baseUrl" | "secrets">;
  apiKey: string | undefined;
}): Record<string, string> {
  return {
    ...data.secrets,
    [API_BASE_URL_SECRET]: data.baseUrl,
    ...(apiKey ? { [API_KEY_SECRET]: apiKey } : {}),
  };
}

const ENTRY = "entry";
const CODE = "api_agent";
const END = "end";
const INPUTS = [
  { identifier: "call_kind", type: "str" },
  { identifier: "payload", type: "str" },
];
const OUTPUTS = [{ identifier: "output", type: "str" }];

/** The entry -> code -> end workflow `execute_sync` runs for one call. */
export function apiAgentWorkflow({
  data,
  specVersion,
  projectApiKey,
  secrets,
  kind,
  payload,
}: {
  data: Pick<
    ApiAgentData,
    "agentId" | "turn" | "setup" | "teardown" | "sandboxApiKey" | "timeoutMs"
  >;
  specVersion: string;
  projectApiKey: string;
  secrets: Record<string, string>;
  kind: ApiCallKind;
  payload: Record<string, unknown>;
}) {
  const values = { call_kind: kind, payload: JSON.stringify(payload) };
  const edge = (source: string, target: string, identifier: string) => ({
    id: `${source}-${target}-${identifier}`,
    source,
    sourceHandle: `outputs.${identifier}`,
    target,
    targetHandle: `inputs.${identifier}`,
    type: "default",
  });
  return {
    workflow: {
      api_key: projectApiKey,
      workflow_id: `scenario-api-agent-${data.agentId}`,
      spec_version: specVersion,
      name: "Scenario API Agent Execution",
      icon: "🔧",
      description: "API agent slot execution",
      version: "1.0",
      template_adapter: "default" as const,
      secrets,
      params: {},
      ...(data.sandboxApiKey ? { sandbox_api_key: data.sandboxApiKey } : {}),
      nodes: [
        {
          id: ENTRY,
          type: "entry",
          position: { x: 0, y: 0 },
          data: {
            name: "Entry",
            outputs: INPUTS,
            entry_selection: "first",
            train_size: 1,
            test_size: 1,
            seed: 42,
            dataset: { id: "scenario-input", name: "Scenario Input", inline: null },
          },
        },
        {
          id: CODE,
          type: "code",
          position: { x: 200, y: 0 },
          data: {
            name: "ApiAgent",
            inputs: INPUTS,
            outputs: OUTPUTS,
            parameters: [
              { identifier: "code", type: "code", value: apiAgentSource(data) },
              ...(data.timeoutMs
                ? [{ identifier: "timeout_ms", type: "int", value: data.timeoutMs }]
                : []),
            ],
            cls: "Code",
          },
        },
        {
          id: END,
          type: "end",
          position: { x: 400, y: 0 },
          data: { name: "End", inputs: OUTPUTS },
        },
      ],
      edges: [
        ...INPUTS.map(({ identifier }) => edge(ENTRY, CODE, identifier)),
        ...OUTPUTS.map(({ identifier }) => edge(CODE, END, identifier)),
      ],
      state: { execution: { status: "idle" } },
    },
    inputs: [values],
  };
}

function isPlainObject(value: unknown): value is HttpHookObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What a hook slot returned: setup's state, or teardown's optional object. Anything but a JSON
 * object (setup), or an object / nothing (teardown), or an object over the state cap, fails it.
 * @throws HttpHookError
 */
export function apiHookAnswer({
  kind,
  output,
}: {
  kind: HttpHookKind;
  output: string;
}): HttpHookObject | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    parsed = undefined;
  }
  if (kind === "teardown" && parsed === null) return undefined;
  if (!isPlainObject(parsed)) {
    throw new HttpHookError({
      message: `The ${kind} slot must return ${kind === "setup" ? "a dict" : "a dict or None"}.`,
    });
  }
  const sizeBytes = Buffer.byteLength(output, "utf8");
  if (sizeBytes > STATE_MAX_BYTES) {
    throw new HttpHookError({
      message: `The ${kind} slot returned ${sizeBytes} bytes, over the ${STATE_MAX_BYTES}-byte cap.`,
    });
  }
  return parsed;
}
