export interface McpConfig {
  apiKey: string | undefined;
  endpoint: string;
  projectId?: string;
  /** Set by the hosted MCP server, so the platform tells its calls from a local server's. */
  hosted?: boolean;
}

export declare function initConfig(args: {
  apiKey?: string;
  endpoint?: string;
  projectId?: string;
}): void;

export declare function tryGetConfig(): McpConfig | undefined;

export declare function getConfig(): McpConfig;

export declare function requireApiKey(): string;

export declare function runWithConfig<T>(config: McpConfig, fn: () => T): T;
