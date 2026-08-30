/**
 * `langwatch/agent`: connect the function that runs an agent to LangWatch
 * so simulations run against it with no public URL.
 *
 * Node only: the connection is an outbound WebSocket that carries the API
 * key in its headers.
 *
 * @see dev/docs/adr/128-connected-agents.md
 */

export { connectAgent, normalizeReply, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS } from "./define";
export type {
  AgentCall,
  AgentHandler,
  AgentOutput,
  AgentReply,
  AgentResult,
  ConnectAgentOptions,
  ConnectedAgent,
  DirectAgentCall,
  InferParameters,
} from "./define";
export { AgentParameterError, toParameterSchema, parameterSpecsFromSchema } from "./schema";
export type {
  ParameterDefinition,
  ParameterDefinitions,
  ParameterInput,
  ParameterSpec,
  ParameterType,
  StandardJsonSchema,
} from "./schema";
export { PROTOCOL_VERSION } from "./protocol";
export type { AgentMessage, AgentParameterValue, JsonSchemaObject } from "./protocol";
export { resolveEnvironment, sanitizeEnvironment, resolveConnectUrl } from "./identity";
