import { AsyncLocalStorage } from "node:async_hooks";

export interface McpConfig {
  apiKey: string | undefined;
  endpoint: string;
}

// ---------------------------------------------------------------------------
// Singleton storage on globalThis
//
// When the langwatch app (CJS, no "type": "module") imports this module,
// tsx creates a CJS-cached copy. When mcp-server's own ESM dist chunks
// do `await import("./search-traces-*.js")`, Node creates a separate
// ESM-cached copy. Module-level variables are NOT shared between them.
//
// By storing config on globalThis, both CJS and ESM instances read/write
// the same object, fixing the "Config not initialized" error that occurs
// when initConfig() runs on the CJS side but tool handlers execute on
// the ESM side.
// ---------------------------------------------------------------------------

const GLOBAL_KEY = "__langwatch_mcp_config" as const;
const STORAGE_KEY = "__langwatch_mcp_config_storage" as const;

interface McpGlobalState {
  globalConfig: McpConfig | undefined;
  configStorage: AsyncLocalStorage<McpConfig>;
}

function getGlobalState(): McpGlobalState {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = undefined;
  }
  if (!g[STORAGE_KEY]) {
    g[STORAGE_KEY] = new AsyncLocalStorage<McpConfig>();
  }
  return {
    get globalConfig() {
      return g[GLOBAL_KEY] as McpConfig | undefined;
    },
    set globalConfig(val: McpConfig | undefined) {
      g[GLOBAL_KEY] = val;
    },
    get configStorage() {
      return g[STORAGE_KEY] as AsyncLocalStorage<McpConfig>;
    },
  };
}

export function initConfig(args: { apiKey?: string; endpoint?: string }): void {
  const state = getGlobalState();
  state.globalConfig = {
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
  const state = getGlobalState();
  const scoped = state.configStorage.getStore();
  if (scoped) return scoped;
  if (!state.globalConfig) {
    console.error(
      "[MCP config] getConfig() failed: globalConfig is null, no scoped config active. " +
        "Was initConfig() called? Stack:",
      new Error().stack,
    );
    throw new Error("Config not initialized");
  }
  return state.globalConfig;
}

export function requireApiKey(): string {
  const config = getConfig();
  if (!config.apiKey) {
    const state = getGlobalState();
    const hasScoped = !!state.configStorage.getStore();
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
  const state = getGlobalState();
  return state.configStorage.run(config, fn);
}
