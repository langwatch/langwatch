import { runAgent as apiRunAgent } from "../langwatch-api-agents.js";

/**
 * Handles the platform_run_agent MCP tool invocation.
 */
export async function handleRunAgent(params: {
  id: string;
  input?: string;
}): Promise<string> {
  let parsedInput: Record<string, unknown> = {};
  if (params.input) {
    try {
      parsedInput = JSON.parse(params.input) as Record<string, unknown>;
    } catch {
      return "Error: `input` must be a valid JSON object.";
    }
  }

  const { agentType, result } = await apiRunAgent(params.id, parsedInput);

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
  }

  return lines.join("\n");
}
