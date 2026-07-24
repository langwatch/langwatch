export interface McpConfig {
  apiKey: string | undefined;
  endpoint: string;
}

export declare function initConfig(args: {
  apiKey?: string;
  endpoint?: string;
}): void;

export declare function getConfig(): McpConfig;

export declare function requireApiKey(): string;

export declare function runWithConfig<T>(config: McpConfig, fn: () => T): T;
