import { AsyncLocalStorage } from "node:async_hooks";

export interface McpConfig {
  apiKey: string | undefined;
  endpoint: string;
}

/**
 * Global config set once at startup via `initConfig()`.
 * Used as the fallback when no per-request config is active.
 */
let globalConfig: McpConfig | undefined;

/**
 * Per-request config scoped via AsyncLocalStorage.
 * When a request handler calls `runWithConfig()`, all downstream code
 * that calls `getConfig()` or `requireApiKey()` receives the scoped config
 * instead of the global one. This enables multi-tenant HTTP mode where
 * each client session carries its own API key.
 */
const configStorage = new AsyncLocalStorage<McpConfig>();

export function initConfig(args: { apiKey?: string; endpoint?: string }): void {
  globalConfig = {
    apiKey: args.apiKey || process.env.LANGWATCH_API_KEY,
    endpoint:
      args.endpoint ||
      process.env.LANGWATCH_ENDPOINT ||
      "https://app.langwatch.ai",
  };
}

/**
 * Returns the current config: the per-request scoped config if inside
 * a `runWithConfig()` callback, otherwise the global config.
 */
export function getConfig(): McpConfig {
  const scoped = configStorage.getStore();
  if (scoped) return scoped;
  if (!globalConfig) {
    console.error(
      "[MCP config] getConfig() failed: globalConfig is null, no scoped config active. " +
        "Was initConfig() called? Stack:",
      new Error().stack,
    );
    throw new Error("Config not initialized");
  }
  return globalConfig;
}

export function requireApiKey(): string {
  const config = getConfig();
  if (!config.apiKey) {
    const hasScoped = !!configStorage.getStore();
    console.error(
      "[MCP config] requireApiKey() failed: apiKey is undefined. " +
        `scopedConfig=${hasScoped}, endpoint=${config.endpoint}. ` +
        "In HTTP mode, the API key should be set per-session via runWithConfig(). Stack:",
      new Error().stack,
    );
    throw new Error(
      "LANGWATCH_API_KEY is required. Set it via --apiKey flag or LANGWATCH_API_KEY environment variable."
    );
  }
  return config.apiKey;
}

/**
 * Runs `fn` with a per-request scoped config. All calls to `getConfig()`
 * and `requireApiKey()` within `fn` (including async continuations) will
 * see the provided config instead of the global one.
 */
export function runWithConfig<T>(config: McpConfig, fn: () => T): T {
  return configStorage.run(config, fn);
}
