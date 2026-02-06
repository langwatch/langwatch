export interface McpConfig {
  apiKey: string | undefined;
  endpoint: string;
}

let config: McpConfig | undefined;

export function initConfig(args: { apiKey?: string; endpoint?: string }): void {
  config = {
    apiKey: args.apiKey || process.env.LANGWATCH_API_KEY,
    endpoint:
      args.endpoint ||
      process.env.LANGWATCH_ENDPOINT ||
      "https://app.langwatch.ai",
  };
}

export function getConfig(): McpConfig {
  if (!config) throw new Error("Config not initialized");
  return config;
}

export function requireApiKey(): string {
  const { apiKey } = getConfig();
  if (!apiKey) {
    throw new Error(
      "LANGWATCH_API_KEY is required. Set it via --apiKey flag or LANGWATCH_API_KEY environment variable."
    );
  }
  return apiKey;
}
