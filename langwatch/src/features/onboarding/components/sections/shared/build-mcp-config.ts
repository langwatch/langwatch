export const CLOUD_ENDPOINT = "https://app.langwatch.ai";

interface BuildMcpInput {
  apiKey: string;
  endpoint: string | undefined;
  /**
   * Project id to surface as `LANGWATCH_PROJECT_ID`. Required for PATs (the
   * unified auth middleware needs it to resolve scope), harmless for legacy
   * `sk-lw-*` keys (the SDK + MCP server simply prefer it when set). We
   * always emit it when supplied so users see one consistent env block
   * regardless of token type.
   */
  projectId?: string;
}

/**
 * Builds the MCP server config object for LangWatch.
 * Includes the self-hosted endpoint only when it differs from the cloud default.
 */
export function buildMcpConfig({
  apiKey,
  endpoint,
  projectId,
}: BuildMcpInput): object {
  const env: Record<string, string> = {
    LANGWATCH_API_KEY: apiKey,
  };

  if (projectId) {
    env.LANGWATCH_PROJECT_ID = projectId;
  }

  if (endpoint && endpoint !== CLOUD_ENDPOINT) {
    env.LANGWATCH_ENDPOINT = endpoint;
  }

  return {
    mcpServers: {
      langwatch: {
        command: "npx",
        args: ["-y", "@langwatch/mcp-server"],
        env,
      },
    },
  };
}

/**
 * Returns the MCP config as a formatted JSON string.
 */
export function buildMcpJson(input: BuildMcpInput): string {
  return JSON.stringify(buildMcpConfig(input), null, 2);
}

/**
 * Returns 1-indexed line numbers of any lines in the given JSON that mention
 * a `LANGWATCH_*` env var key. Used by the empty-state onboarding to mark
 * the user-actionable lines in the MCP config preview.
 */
export function findLangwatchEnvLines(json: string): number[] {
  const KEYS = [
    "LANGWATCH_API_KEY",
    "LANGWATCH_PROJECT_ID",
    "LANGWATCH_ENDPOINT",
  ];
  const out: number[] = [];
  json.split("\n").forEach((line, idx) => {
    if (KEYS.some((k) => line.includes(k))) out.push(idx + 1);
  });
  return out;
}
