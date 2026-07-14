import type { TypedAgent } from "~/server/agents/agent.repository";
import type {
  AgentComponent,
  Field,
  HttpAuth,
  HttpHeader,
  HttpMethod,
} from "../types/dsl";

/**
 * Translation layer between an agent library record and the workflow
 * DSL node that executes it. The node's parameters are what the
 * backend parser reads, so every place that writes an agent into a
 * node (drag-drop pick, create-new, drawer Save, library refresh) must
 * produce the same shape - keep them all on these builders.
 */

export function mapAgentInputs(agent: TypedAgent): Field[] {
  const config = agent.config;
  if (
    "inputs" in config &&
    Array.isArray(config.inputs) &&
    config.inputs.length > 0
  ) {
    return config.inputs.map((i: { identifier: string; type: string }) => ({
      identifier: i.identifier,
      type: i.type as Field["type"],
    }));
  }
  // Default input for agents
  return [{ identifier: "input", type: "str" }];
}

export function mapAgentOutputs(agent: TypedAgent): Field[] {
  const config = agent.config;
  if (
    "outputs" in config &&
    Array.isArray(config.outputs) &&
    config.outputs.length > 0
  ) {
    return config.outputs.map((o: { identifier: string; type: string }) => ({
      identifier: o.identifier,
      type: o.type as Field["type"],
    }));
  }
  // Default output
  return [{ identifier: "output", type: "str" }];
}

/**
 * Build parameters array from agent config for backend execution.
 * The backend parser reads parameters to determine how to execute.
 */
export function buildAgentParameters(agent: TypedAgent): Field[] {
  const params: Field[] = [
    { identifier: "agent_type", type: "str", value: agent.type },
  ];

  const config = agent.config as Record<string, unknown>;

  switch (agent.type) {
    case "http": {
      if (config.url)
        params.push({
          identifier: "url",
          type: "str",
          value: config.url as string,
        });
      if (config.method)
        params.push({
          identifier: "method",
          type: "str",
          value: config.method as string,
        });
      if (config.bodyTemplate)
        params.push({
          identifier: "body_template",
          type: "str",
          value: config.bodyTemplate as string,
        });
      if (config.outputPath)
        params.push({
          identifier: "output_path",
          type: "str",
          value: config.outputPath as string,
        });
      if (config.timeoutMs)
        params.push({
          identifier: "timeout_ms",
          type: "str",
          value: config.timeoutMs,
        });

      // Auth
      const auth = config.auth as Record<string, string> | undefined;
      if (auth?.type && auth.type !== "none") {
        params.push({ identifier: "auth_type", type: "str", value: auth.type });
        if (auth.token)
          params.push({
            identifier: "auth_token",
            type: "str",
            value: auth.token,
          });
        if (auth.header)
          params.push({
            identifier: "auth_header",
            type: "str",
            value: auth.header,
          });
        if (auth.value)
          params.push({
            identifier: "auth_value",
            type: "str",
            value: auth.value,
          });
        if (auth.username)
          params.push({
            identifier: "auth_username",
            type: "str",
            value: auth.username,
          });
        if (auth.password)
          params.push({
            identifier: "auth_password",
            type: "str",
            value: auth.password,
          });
      }

      // Headers
      if (config.headers && typeof config.headers === "object") {
        const headers = Array.isArray(config.headers)
          ? Object.fromEntries(
              (config.headers as Array<{ key: string; value: string }>)
                .filter((h) => h.key)
                .map((h) => [h.key, h.value]),
            )
          : config.headers;
        params.push({ identifier: "headers", type: "str", value: headers });
      }
      break;
    }
    case "code": {
      // Code agents store their code in the parameters
      const existingParams = config.parameters as
        | Array<{ identifier: string; type: string; value: unknown }>
        | undefined;
      const codeParam = existingParams?.find((p) => p.identifier === "code");
      if (codeParam) {
        params.push({
          identifier: "code",
          type: "code",
          value: codeParam.value as string,
        });
      }
      break;
    }
    case "workflow": {
      if (config.workflow_id)
        params.push({
          identifier: "workflow_id",
          type: "str",
          value: config.workflow_id as string,
        });
      if (config.version_id)
        params.push({
          identifier: "version_id",
          type: "str",
          value: config.version_id as string,
        });
      break;
    }
  }

  return params;
}

/**
 * The full node-data overlay for a db-backed agent: what a node must
 * carry so the workflow executes this agent definition.
 */
export function buildAgentNodeData(agent: TypedAgent): Partial<AgentComponent> {
  return {
    name: agent.name,
    agent: `agents/${agent.id}`,
    agentType: agent.type as AgentComponent["agentType"],
    inputs: mapAgentInputs(agent),
    outputs: mapAgentOutputs(agent),
    parameters: buildAgentParameters(agent),
  };
}

function readParameter(
  data: Pick<AgentComponent, "parameters">,
  identifier: string,
): unknown {
  return data.parameters?.find((p) => p.identifier === identifier)?.value;
}

/**
 * The code a code-agent node would execute, straight from the node's
 * DSL snapshot. Undefined when the node carries no snapshot (callers
 * decide the fallback - never silently the starter template).
 */
export function readCodeSnapshot(
  data: Pick<AgentComponent, "parameters">,
): string | undefined {
  const value = readParameter(data, "code");
  return typeof value === "string" ? value : undefined;
}

export type HttpNodeSnapshot = {
  url?: string;
  method?: HttpMethod;
  bodyTemplate?: string;
  outputPath?: string;
  headers?: HttpHeader[];
  auth?: HttpAuth;
};

/**
 * Reverse of the http branch of buildAgentParameters: the editor-shaped
 * http settings a node's DSL snapshot carries.
 */
export function readHttpSnapshot(
  data: Pick<AgentComponent, "parameters">,
): HttpNodeSnapshot | undefined {
  if (readParameter(data, "agent_type") !== "http") return undefined;

  const headersValue = readParameter(data, "headers");
  const headers =
    headersValue && typeof headersValue === "object"
      ? Object.entries(headersValue as Record<string, string>).map(
          ([key, value]) => ({ key, value }),
        )
      : undefined;

  const authType = readParameter(data, "auth_type");
  const auth: HttpAuth | undefined =
    typeof authType === "string"
      ? ({
          type: authType,
          token: readParameter(data, "auth_token"),
          header: readParameter(data, "auth_header"),
          value: readParameter(data, "auth_value"),
          username: readParameter(data, "auth_username"),
          password: readParameter(data, "auth_password"),
        } as HttpAuth)
      : undefined;

  return {
    url: readParameter(data, "url") as string | undefined,
    method: readParameter(data, "method") as HttpMethod | undefined,
    bodyTemplate: readParameter(data, "body_template") as string | undefined,
    outputPath: readParameter(data, "output_path") as string | undefined,
    headers,
    auth,
  };
}

/**
 * Whether the node's DSL snapshot already reflects this agent record.
 * Used to tell "first fetch of an unchanged record" apart from "the
 * record changed elsewhere and the node needs refreshing".
 */
export function nodeMatchesAgent(
  data: Pick<AgentComponent, "name" | "parameters" | "inputs" | "outputs">,
  agent: TypedAgent,
): boolean {
  const expected = buildAgentNodeData(agent);
  return (
    data.name === expected.name &&
    JSON.stringify(data.parameters ?? []) ===
      JSON.stringify(expected.parameters ?? []) &&
    JSON.stringify(data.inputs ?? []) ===
      JSON.stringify(expected.inputs ?? []) &&
    JSON.stringify(data.outputs ?? []) ===
      JSON.stringify(expected.outputs ?? [])
  );
}
