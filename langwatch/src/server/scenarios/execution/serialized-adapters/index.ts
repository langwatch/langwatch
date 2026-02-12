/**
 * Barrel export for serialized adapters.
 *
 * These adapters operate with pre-fetched configuration data and don't require
 * database access. They're designed to run in isolated worker threads.
 */

export { SerializedCodeAgentAdapter } from "./code-agent.adapter";
export { SerializedHttpAgentAdapter } from "./http-agent.adapter";
export { SerializedPromptConfigAdapter } from "./prompt-config.adapter";
