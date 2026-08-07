/**
 * Per-tool gateway env mapping (Path A). Leaf module with no
 * governance-internal imports so both the spawn orchestrator
 * (wrapper.ts) and the persist/refresh surfaces (shell-rc.ts,
 * telemetry-refresh.ts) can share it without import cycles.
 */

import { normalizeEndpoint } from "../../../internal/endpoint";
import type { GovernanceConfig } from "./config";

export interface ToolEnv {
	/** Env-var name → value pairs to inject into the child process. */
	vars: Record<string, string>;
	/**
	 * Env-var names to STRIP from the inherited parent environment
	 * before spawning the tool. Used to scrub legacy credentials the
	 * user has exported in their shell (e.g. ANTHROPIC_API_KEY set
	 * from a previous direct-Anthropic workflow) that would otherwise
	 * race with the gateway-routed auth (ANTHROPIC_AUTH_TOKEN) we
	 * inject - claude-code 2.x detects both and warns
	 * "auth may not work as expected", so we have to actively unset
	 * the conflicting twin rather than just pile on top of it.
	 * Unset BEFORE the merge so a tool that intentionally sets both
	 * (opencode for provider auto-detect) still wins.
	 */
	clears?: string[];
}

/**
 * Mirror of the Go CLI's env-injection map. The wrapped tools
 * read these standard env vars (Anthropic, OpenAI, Google) and
 * route through the gateway with the user's personal VK as bearer.
 *
 * Gateway-only on purpose: when the VK is on the API path the
 * gateway already captures every request + response server-side
 * (full I/O, exact cost). Injecting OTEL_* on top would make the
 * wrapped tool emit its own telemetry for the SAME calls = double
 * trace + double cost in /messages. The OTLP ingest path is for
 * users who can't go through the gateway at all (Claude Max
 * subscription, no swappable API key); they paste the OTEL env
 * block from the /me drawer manually. See
 * docs/ai-governance/track-your-claude-code-usage.mdx (Path A vs
 * Path B).
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
			// gemini-cli 0.46-preview honours `GOOGLE_GEMINI_BASE_URL`
			// (verified empirically in the bundled binary). It POSTs to
			// `{BASE}/v1beta/models/{model}:generateContent`, prepending
			// the `/v1beta/` itself. The base must therefore be the bare
			// gateway URL without the API version suffix; an earlier guess
			// of `${gw}/v1beta` doubled the prefix to `/v1beta/v1beta/` and
			// the gateway 404'd the routing call, surfacing as
			// "Unexpected end of JSON input" on the cli side.
			// `GOOGLE_GENAI_API_BASE` is NOT read by gemini-cli (separate
			// guess that silently no-op'd in earlier wrapper revisions).
			return {
				vars: {
					GOOGLE_GEMINI_BASE_URL: gw,
					GEMINI_API_KEY: auth,
					GOOGLE_API_KEY: auth,
				},
			};
		case "opencode":
			// opencode 1.x is multi-provider; under the hood it uses the
			// Vercel AI SDK, which appends `/messages` and `/chat/completions`
			// to the configured base URL WITHOUT prepending `/v1`. So opencode
			// needs the base to ALREADY include `/v1`, unlike claude-code +
			// codex which append it themselves. Verified via `--log-level
			// DEBUG` - opencode hit `${ANTHROPIC_BASE_URL}/messages` and
			// got a gateway 404 because the gateway exposes `/v1/messages`.
			//
			// Also: opencode's provider auto-detection at init time gates on
			// ANTHROPIC_API_KEY (NOT ANTHROPIC_AUTH_TOKEN, which claude-code
			// uses). Without it, opencode logs `providerID=openai found` /
			// `providerID=opencode found` but NOT anthropic, then fails any
			// `--model anthropic/...` invocation with ProviderModelNotFoundError.
			// Set both so anthropic is detected AND the gateway gets the VK on
			// the wire (the AI SDK forwards x-api-key from ANTHROPIC_API_KEY).
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
