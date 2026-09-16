// Token snippets and masking hygiene: minted token reaches browser once; display masked but copy
// real; mask blob not token for base64. Moved from platform/app and onboarding; family-local
// copies.

/** The endpoint a snippet omits, because it is the default the SDK already has. */
export const CLOUD_ENDPOINT = "https://app.langwatch.ai";

/** Mask the middle of a secret string for display. */
export function maskSecret(v: string): string {
  if (v.length <= 8) return "********";
  return `${v.slice(0, 4)}${"*".repeat(Math.min(v.length - 8, 32))}${v.slice(-4)}`;
}

/**
 * Masks an API key for display: the first 6 and last 4 characters, with
 * bullet characters between them. Returns an empty string when the key
 * is empty/falsy.
 */
export function maskApiKey(key: string): string {
  if (!key) return "";
  return `${key.slice(0, 6)}${"•".repeat(4)}${key.slice(-4)}`;
}

/** Build a `.env` snippet from key/value entries. */
export function formatEnvLines(
  entries: { key: string; value: string; mask?: boolean }[],
): string {
  return entries
    .map(({ key, value, mask }) => `${key}="${mask ? maskSecret(value) : value}"`)
    .join("\n");
}

interface BuildMcpInput {
  apiKey: string;
  endpoint: string | undefined;
  /**
   * Project id to surface as `LANGWATCH_PROJECT_ID`: required for API keys
   * (scope resolution), harmless for legacy `sk-lw-*` keys. Always emitted
   * when supplied, for one consistent env block regardless of token type.
   */
  projectId?: string;
}

/**
 * Builds the MCP server config object for LangWatch.
 * Includes the self-hosted endpoint only when it differs from the cloud default.
 */
export function buildMcpConfig({ apiKey, endpoint, projectId }: BuildMcpInput): object {
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
  const KEYS = ["LANGWATCH_API_KEY", "LANGWATCH_PROJECT_ID", "LANGWATCH_ENDPOINT"];
  const out: number[] = [];
  json.split("\n").forEach((line, idx) => {
    if (KEYS.some((k) => line.includes(k))) out.push(idx + 1);
  });
  return out;
}
