/**
 * The snippets the "Token Created" dialog shows once, and the masking around
 * them.
 *
 * CREDENTIAL HYGIENE IS THIS MODULE'S WHOLE SUBJECT, so it is worth stating the
 * rules in one place rather than leaving them implied by four call sites:
 *
 *  1. A minted token reaches the browser exactly once, in the `create` mutation's
 *     answer. Nothing on the list wire carries it — `apiKey.list` answers a
 *     `lookupIdPrefix`, which is why the table renders `sk-lw-<prefix>…` and can
 *     never render more.
 *  2. What is DISPLAYED is masked until the reader asks to see it; what is
 *     COPIED is always the real value. Those are different strings on purpose:
 *     a copy button that hands over the masked form gives the reader a
 *     credential that fails only when they paste it into an SDK.
 *  3. The Basic Auth tab masks the BASE64 BLOB, not the token. A token is not a
 *     substring of its own base64, so masking on the token there would silently
 *     fail open and render the credential in full.
 *
 * Moved from `platform/app/src/pages/settings/api-keys/utils.ts` and
 * `features/onboarding/components/sections/shared/{api-key-utils,build-mcp-config}.ts`.
 * The onboarding modules did not travel — eight other surfaces import them — so
 * these are family-local copies, and `token-created-snippets.unit.test.ts`
 * drives them rather than reading either file off disk.
 */

/** The endpoint a snippet omits, because it is the default the SDK already has. */
export const CLOUD_ENDPOINT = "https://app.langwatch.ai";

/** Mask the middle of a secret string for display. */
export function maskSecret(v: string): string {
  if (v.length <= 8) return "********";
  return `${v.slice(0, 4)}${"*".repeat(Math.min(v.length - 8, 32))}${v.slice(-4)}`;
}

/**
 * Masks an API key for display, showing the first 6 and last 4 characters
 * with bullet characters in between.
 *
 * Returns an empty string when the key is empty/falsy.
 */
export function maskApiKey(key: string): string {
  if (!key) return "";
  return `${key.slice(0, 6)}${"•".repeat(4)}${key.slice(-4)}`;
}

/** Build a `.env` snippet from key/value entries. */
export function formatEnvLines(
  entries: Array<{ key: string; value: string; mask?: boolean }>,
): string {
  return entries
    .map(({ key, value, mask }) => `${key}="${mask ? maskSecret(value) : value}"`)
    .join("\n");
}

interface BuildMcpInput {
  apiKey: string;
  endpoint: string | undefined;
  /**
   * Project id to surface as `LANGWATCH_PROJECT_ID`. Required for API keys (the
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
