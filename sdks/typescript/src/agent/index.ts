/**
 * Connect an agent function to LangWatch for simulation.
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
