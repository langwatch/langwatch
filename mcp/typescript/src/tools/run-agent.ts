import {
  runAgent as apiRunAgent,
  type AgentCallParams,
} from "../langwatch-api-agents.js";

/**
 * Handles the platform_run_agent MCP tool invocation.
 *
 * @see specs/mcp-server/agent-tools.feature
 */
export async function handleRunAgent({
  id,
  input,
  message,
  parameters,
  threadId,
}: {
  id: string;
  input?: string;
  message?: string;
  parameters?: AgentCallParams;
  threadId?: string;
}): Promise<string> {
  let parsedInput: Record<string, unknown> = {};
  if (input) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      return "Error: `input` must be a valid JSON object.";
    }
    // A scalar and an array both parse, and either one reaches the agent as a
    // body it cannot read.
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return "Error: `input` must be a valid JSON object.";
    }
    parsedInput = parsed as Record<string, unknown>;
  }

  const { agentType, result } = await apiRunAgent({
    id,
    input: parsedInput,
    message,
    parameters,
    threadId,
  });

  const lines: string[] = [];
  lines.push(`Agent executed successfully (type: ${agentType}).\n`);

  if (typeof result === "object" && result !== null) {
    const output = (result as Record<string, unknown>).output;
    if (output !== undefined) {
      lines.push("**Output:**");
      lines.push(typeof output === "string" ? output : JSON.stringify(output, null, 2));
    } else {
      lines.push("**Result:**");
      lines.push(JSON.stringify(result, null, 2));
    }
    if (agentType === "connected") {
      const instance = (result as { instance?: { hostname?: string; label?: string | null } }).instance;
      const durationMs = (result as { durationMs?: number }).durationMs;
      if (instance?.hostname) {
        const label = instance.label ? ` (${instance.label})` : "";
        lines.push(`\n**Instance:** ${instance.hostname}${label}`);
      }
      if (typeof durationMs === "number") lines.push(`**Duration:** ${durationMs} ms`);
      const session = (result as { session?: unknown }).session;
      if (session !== undefined && session !== null) {
        lines.push("**Session:**");
        lines.push(JSON.stringify(session, null, 2));
      }
    }
  }

  return lines.join("\n");
}
