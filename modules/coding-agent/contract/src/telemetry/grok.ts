import { type CodingAgentDefinition, signalSays } from "./coding-agent-definition.ts";

/**
 * Grok CLI (ADR-192): exports logs and metrics only, with Claude Code's event
 * vocabulary under `grok_code.`. Never matched on the model name: `grok-*`
 * models also run behind other agents and the gateway.
 */
export const grokAgent: CodingAgentDefinition = {
  id: "grok",
  matches: (signal) => signalSays(signal, "grok_code") || signal.service === "grok-cli",
  namePrefixes: ["grok_code."],

  // Model calls and tool runs arrive only as log events, as Cowork's do.
  logsOnly: true,
  // `mcp_server_connection` and `subagent` records carry no session id.
  logsRequireSessionKey: true,

  // The OpenAI convention: `input_tokens` already holds the cache reads.
  logInputIncludesCacheRead: true,
  logCostUsdMicrosAttribute: "cost_usd_micros",
};
