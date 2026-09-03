/**
 * `langwatch/agent`: connect the function that runs an agent to LangWatch
 * so simulations run against it with no public URL.
 *
 * Node only, and outbound only. The default transport is a WebSocket that
 * carries the API key in its request headers. It falls back to HTTP long
 * polling when a proxy refuses the upgrade, and
 * `LANGWATCH_AGENT_TRANSPORT=http` selects HTTP long polling from the start.
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
export {
  resolveEnvironment,
  sanitizeEnvironment,
  resolveConnectUrl,
  resolveHttpConnectUrl,
} from "./identity";
export { resolveTransport, AGENT_TRANSPORTS } from "./transport";
export type { AgentTransport } from "./transport";
