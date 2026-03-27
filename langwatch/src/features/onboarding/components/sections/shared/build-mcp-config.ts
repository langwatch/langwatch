export const CLOUD_ENDPOINT = "https://app.langwatch.ai";

/**
 * Builds the MCP server config object for LangWatch.
 * Includes the self-hosted endpoint only when it differs from the cloud default.
 */
export function buildMcpConfig({
  apiKey,
  endpoint,
}: {
  apiKey: string;
  endpoint: string | undefined;
}): object {
  const env: Record<string, string> = {
    LANGWATCH_API_KEY: apiKey,
  };

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
export function buildMcpJson({
  apiKey,
  endpoint,
}: {
  apiKey: string;
  endpoint: string | undefined;
}): string {
  return JSON.stringify(buildMcpConfig({ apiKey, endpoint }), null, 2);
}
