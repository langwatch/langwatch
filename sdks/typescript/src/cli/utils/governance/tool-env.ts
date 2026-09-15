/**
 * Per-tool gateway env mapping (Path A). Leaf module with no
 * governance-internal imports so both the spawn orchestrator
 * (wrapper.ts) and the persist/refresh surfaces (shell-rc.ts,
 * telemetry-refresh.ts) can share it without import cycles.
 */

import { normalizeEndpoint } from "../../../internal/endpoint";
import type { GovernanceConfig } from "./config";
import { telemetryEnvVarNames } from "./otel-env-block";

export interface ToolEnv {
  /** Env-var name → value pairs to inject into the child process. */
  vars: Record<string, string>;
  /**
   * Env-var names to strip to avoid conflicting auth tokens.
   * Scrubs legacy credentials (e.g., ANTHROPIC_API_KEY) before injection.
   */
  clears?: string[];
}

/**
 * Injects credentials for the wrapped tool to route through the gateway.
 * Gateway captures full I/O, so we don't also emit OTEL_ telemetry.
 */
export function envForTool(cfg: GovernanceConfig, tool: string): ToolEnv {
  const gw = normalizeEndpoint(cfg.gateway_url);
  const auth = cfg.default_personal_vk?.secret;
  if (!auth) return { vars: {} };
  switch (tool) {
    case "claude":
      // claude-code (2.1.x) appends `/v1/messages` to ANTHROPIC_BASE_URL itself.
      // Clear the legacy ANTHROPIC_API_KEY twin: claude-code warns
      // "Both ANTHROPIC_AUTH_TOKEN and ANTHROPIC_API_KEY set, auth may
      // not work as expected" when both are present (the gateway route
      // uses AUTH_TOKEN; API_KEY is left over from pre-langwatch direct
      // SDK usage). Stripping it leaves only the gateway-routed creds
      // on the child env.
      return {
        vars: {
          ANTHROPIC_BASE_URL: gw,
          ANTHROPIC_AUTH_TOKEN: auth,
        },
        clears: ["ANTHROPIC_API_KEY"],
      };
    case "codex":
      // codex 0.134 appends `/v1/chat/completions` itself.
      return {
        vars: {
          OPENAI_BASE_URL: gw,
          OPENAI_API_KEY: auth,
        },
      };
    case "cursor":
      // Same warning surface as claude: Anthropic SDKs nested in
      // cursor's runtime will read ANTHROPIC_API_KEY in preference to
      // ANTHROPIC_AUTH_TOKEN if both are set, bypassing the gateway.
      // Scrub the legacy key.
      return {
        vars: {
          OPENAI_BASE_URL: gw,
          OPENAI_API_KEY: auth,
          ANTHROPIC_BASE_URL: gw,
          ANTHROPIC_AUTH_TOKEN: auth,
        },
        clears: ["ANTHROPIC_API_KEY"],
      };
    case "gemini":
      // Base URL must not include /v1beta; gemini-cli prepends it.
      return {
        vars: {
          GOOGLE_GEMINI_BASE_URL: gw,
          GEMINI_API_KEY: auth,
          GOOGLE_API_KEY: auth,
        },
      };
    case "copilot":
      // Copilot needs base URL with /v1 (unlike claude-code, codex).
      // Clear telemetry env vars to avoid double-tracing in gateway mode.
      return {
        vars: {
          COPILOT_PROVIDER_TYPE: "openai",
          COPILOT_PROVIDER_BASE_URL: `${gw}/v1`,
          COPILOT_PROVIDER_API_KEY: auth,
        },
        clears: telemetryEnvVarNames("copilot"),
      };
    case "opencode":
      // Opencode uses Vercel AI SDK, needs base URL with /v1.
      // Set ANTHROPIC_API_KEY for provider detection.
      return {
        vars: {
          OPENAI_BASE_URL: `${gw}/v1`,
          OPENAI_API_KEY: auth,
          ANTHROPIC_BASE_URL: `${gw}/v1`,
          ANTHROPIC_AUTH_TOKEN: auth,
          ANTHROPIC_API_KEY: auth,
        },
      };
    default:
      return { vars: {} };
  }
}
