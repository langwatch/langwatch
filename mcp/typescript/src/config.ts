import { AsyncLocalStorage } from "node:async_hooks";

export interface McpConfig {
  apiKey: string | undefined;
  endpoint: string;
  projectId?: string;
}

// Store on globalThis to share config between CJS and ESM module instances.

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

/** Trim surrounding whitespace and drop any trailing slashes. */
/**
 * Request URLs are built as `${endpoint}/api/...`; a trailing slash would
 * double up and 404 with nothing pointing at the endpoint as the cause.
 */
function normalizeEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  let end = trimmed.length;
  while (end > 0 && trimmed[end - 1] === "/") end--;
  return trimmed.slice(0, end);
}

export function initConfig(args: { apiKey?: string; endpoint?: string; projectId?: string }): void {
  const state = getGlobalState();
  state.globalConfig = {
    apiKey: args.apiKey || process.env.LANGWATCH_API_KEY,
    endpoint:
      normalizeEndpoint(args.endpoint ?? "") ||
      normalizeEndpoint(process.env.LANGWATCH_ENDPOINT ?? "") ||
      "https://app.langwatch.ai",
    projectId: args.projectId ?? process.env.LANGWATCH_PROJECT_ID,
  };
}

// Current config: per-request scoped if inside runWithConfig(), otherwise global.
// Returns undefined rather than throwing so callers don't need try/catch.
export function tryGetConfig(): McpConfig | undefined {
  const state = getGlobalState();
  return state.configStorage.getStore() ?? state.globalConfig;
}

/** The current config: per-request scoped inside runWithConfig(), else global. */
/**
 * Throws when there is none — every caller here needs it to proceed. A
 * caller that can carry on without it asks `tryGetConfig()` instead.
 */
export function getConfig(): McpConfig {
  const config = tryGetConfig();
  if (!config) {
    console.error(
      "[MCP config] getConfig() failed: globalConfig is null, no scoped config active. " +
        "Was initConfig() called? Stack:",
      new Error().stack,
    );
    throw new Error("Config not initialized");
  }
  return config;
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
      "LANGWATCH_API_KEY is required. Set it via --apiKey flag or LANGWATCH_API_KEY environment variable.",
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
