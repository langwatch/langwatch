/**
 * Per-tool Path B (ingestion) OTel env block builder. Leaf module so the
 * three consumers - the mode resolver (wrapper-mode.ts), the persisted-
 * wiring refresh (telemetry-refresh.ts), and the logout scan
 * (telemetry-targets.ts) - can all derive the SAME key set and values
 * without import cycles. Install, refresh, and removal all read from
 * this one builder, so the surfaces can never drift apart.
 */

/** Ingestion source_type slug per wrapped tool (mint + cache key). */
export const SOURCE_TYPE_BY_TOOL: Record<string, string> = {
	claude: "claude_code",
	codex: "codex",
	gemini: "gemini",
	opencode: "opencode",
	// `copilot_cli`, NOT `copilot` — `copilot_studio` (the Microsoft
	// Copilot Studio audit feed) already exists as a sourceType and a bare
	// `copilot` would be confusable with it in the API-keys page and
	// analytics filters. ADR-039 Decision 2.
	copilot: "copilot_cli",
	// `code` = the VS Code Copilot Chat extension. Its own sourceType so the
	// editor surface is separable from the CLI (`copilot_cli`) and app
	// (`copilot_app`) in the API-keys page and analytics. ADR-039 §Extension #2.
	code: "copilot_vscode",
	// pi exports NO telemetry of its own, and unlike every other entry here it
	// must receive no OTel env block at all — see the `case "pi"` in
	// buildOtelEnvBlock below. Its presence in this table is solely the mint
	// key for the ingest key the wrapper uses to POST pi's session transcript
	// after the child exits (ADR-132 §7). This table names source types; it is
	// NOT a list of tools that export. Those two meanings were conflated once
	// already and leaked a bearer token into pi's child environment.
	pi: "pi",
};

/**
 * The same table read the other way, for callers that hold a source type and
 * need the tool slug the rest of the config is keyed by (`tool_project_keys`,
 * `tool_mode`, `tool_policies`). Derived, so the two can never disagree.
 */
export const TOOL_BY_SOURCE_TYPE: Record<string, string> = Object.fromEntries(
	Object.entries(SOURCE_TYPE_BY_TOOL).map(([tool, sourceType]) => [
		sourceType,
		tool,
	]),
);

/**
 * The env var names langwatch persists for `tool`'s Path B telemetry.
 * Derived from the same builder that installs them, so the logout /
 * removal path can strip exactly the keys the install path wrote (no
 * drift). Values are irrelevant here, so placeholders are passed in.
 */
export function telemetryEnvVarNames(tool: string): string[] {
	return Object.keys(buildOtelEnvBlock(tool, "", ""));
}

/**
 * Does `tool` ship an OTel exporter we can wire up?
 *
 * Derived from the env block, not a second hand-kept list: a tool we hand no
 * vars to is a tool with nothing to instrument. Keeps `langwatch instrument`
 * from writing persistent wiring — and minting a real ingest key — for a tool
 * that will never emit. See the `case "pi"` in buildOtelEnvBlock.
 */
export function exportsTelemetry(tool: string): boolean {
	return telemetryEnvVarNames(tool).length > 0;
}

/** The tools `langwatch instrument` accepts, in table order. */
export function instrumentableTools(): string[] {
	return Object.keys(SOURCE_TYPE_BY_TOOL).filter(exportsTelemetry);
}

export function buildOtelEnvBlock(
	tool: string,
	endpoint: string,
	token: string,
): Record<string, string> {
	const base = {
		OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
		OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${token}`,
	};

	switch (tool) {
		case "pi":
			// The ONLY tool that gets an empty block, and deliberately so.
			//
			// pi ships no OTel exporter (verified against the shipped `dist/`
			// of @earendil-works/pi-coding-agent: zero references to OTEL_,
			// otlp or opentelemetry). It would ignore these vars — but the
			// child does not run alone. wrapper.ts:707 merges this block into
			// the child env, and on an interactive shell buildShellReapply
			// (wrapper.ts:296-312) re-`export`s it into the session, so every
			// process the developer starts inside `langwatch pi` inherits an
			// endpoint AND a live bearer token. An OTel-instrumented dev
			// server, a pytest run, or the user's own app would then POST its
			// spans to us authenticated as pi.
			//
			// This is the hazard ingestKeyProvenance.utils.ts:150-158 already
			// documents for the VS Code extension, which answers it with a
			// server-side scope gate (COPILOT_VSCODE_ALLOWED_SCOPES, enforced
			// by dropForeignScopesForVscodeKey). That gate early-returns for
			// any other source type, so it would never cover pi. Receiver-side
			// filtering is also the wrong answer here: the exposed token is
			// itself the problem, independent of which spans get accepted.
			//
			// Returning {} means the wrapper hands pi's child nothing. Capture
			// is unaffected — the endpoint and token stay in the mode result
			// (wrapper-mode.ts:600-601) for the post-exit transcript POST, and
			// telemetryEnvVarNames is only ever called with "claude" and
			// "copilot", so no logout or refresh sweep depends on this key set.
			return {};
		case "claude":
			// Three further OTel unlock knobs found in the claude-code 2.x
			// bundled binary string sweep (alongside OTEL_LOG_USER_PROMPTS
			// which we already set), all four officially documented on
			// code.claude.com/docs/en/monitoring-usage:
			//   OTEL_LOG_TOOL_DETAILS  - lifts tool_input / tool_parameters
			//     attrs (Bash command text, Edit diffs, Read file paths,
			//     etc) onto tool_decision + tool_result events. The
			//     receiver-side previously had only `tool_input_size_bytes`
			//     and `tool_result_size_bytes` - proven across the
			//     andre-claude-tool-calls + sergey-third-eye dump set.
			//   OTEL_LOG_TOOL_CONTENT  - lifts tool input/output content onto
			//     the `tool.output` span event of claude_code.tool spans.
			//     Active because we now set CLAUDE_CODE_ENHANCED_TELEMETRY_BETA
			//     below, which unlocks the real span-tracing signal (see note).
			//     Tool I/O on the logs path also still comes from
			//     TOOL_DETAILS + RAW_API_BODIES.
			//   OTEL_LOG_RAW_API_BODIES - emits two NEW event types
			//     `api_request_body` + `api_response_body` carrying the
			//     FULL JSON of every message (system prompts + user content
			//     + assistant text + tool_use blocks). THIS IS THE ONLY
			//     surface that carries the assistant response text - every
			//     other event (api_request, user_prompt, tool_*) is
			//     metadata only. Andre's live-dogfood (proxy intercept on
			//     :4318) found "UNLOCK-KNOBS-TEST-PROOF-7777" in
			//     api_response_body.content[].text with this flag set. Also
			//     the heaviest payload class (system prompts can be 100KB+,
			//     message history grows turn-over-turn) - same fat-payload
			//     class as the CH merge memory-ceiling incident
			//     [[project_skai_ch_merge_memory_ceiling_outage]].
			//
			// Default policy: ALL FOUR knobs ON. rchaves "fix everything,
			// collect all humanly possible". Payload risk is bounded:
			// claude 2.x caps api_request_body + api_response_body at 60KB
			// INLINE per event (inline is the default; the optional
			// file:<dir> mode that writes untruncated bodies to disk is NOT
			// enabled). Alexis ships a complementary receiver-side guard
			// in the same PR as defense-in-depth on fold accumulation +
			// a Body cap in case future claude versions remove the 60KB
			// inline limit. PII / logging-opt-out controls already live on
			// the platform settings page. Note: extended-thinking content
			// is ALWAYS redacted by claude from raw bodies - we cannot
			// capture it regardless of flag state.
			//
			// CLAUDE_CODE_ENHANCED_TELEMETRY_BETA unlocks the real span-tracing
			// signal (scope com.anthropic.claude_code.tracing): claude_code
			// interaction / llm_request / tool / tool.execution / subagent.spawn
			// spans, carrying agent_id + parent_agent_id. That is the ONLY
			// telemetry that ties each model call / tool run to the sub-agent
			// that issued it and reconstructs the sub-agent tree. Without it
			// OTEL_TRACES_EXPORTER is a no-op for claude-code, every log arrives
			// context-less, and the receiver collapses every sub-agent into one
			// synthesized per-turn trace. Content (prompts/responses) still rides
			// the log events and joins to the llm_request span by request_id.
			return {
				CLAUDE_CODE_ENABLE_TELEMETRY: "1",
				CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1",
				OTEL_TRACES_EXPORTER: "otlp",
				OTEL_LOGS_EXPORTER: "otlp",
				OTEL_METRICS_EXPORTER: "otlp",
				OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
				OTEL_LOG_USER_PROMPTS: "1",
				OTEL_LOG_TOOL_DETAILS: "1",
				OTEL_LOG_TOOL_CONTENT: "1",
				OTEL_LOG_RAW_API_BODIES: "1",
				...base,
				OTEL_RESOURCE_ATTRIBUTES: "service.name=claude-code",
			};
		case "codex":
			return {
				OTEL_TRACES_EXPORTER: "otlp",
				OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
				...base,
				OTEL_RESOURCE_ATTRIBUTES: "service.name=codex",
			};
		case "gemini":
			// gemini-cli 0.46 telemetry resolver (packages/core/dist/src/telemetry/config.js):
			//   target ∈ {local, gcp} - NOT otlp. The JSON-schema doc string
			//   mentions otlp as an "example", but the runtime validator
			//   (parseTelemetryTargetValue) only accepts local|gcp; passing
			//   otlp throws FatalConfigError at startup.
			//   To forward spans + log records to our OTLP endpoint we use
			//   `local` (in-process exporters) + `useCollector=true` which
			//   routes through @opentelemetry/exporter-trace-otlp-http +
			//   exporter-logs-otlp-http to GEMINI_TELEMETRY_OTLP_ENDPOINT
			//   (falls back to OTEL_EXPORTER_OTLP_ENDPOINT).
			//   `traces=true` enables the detail-attribute span path so the
			//   user prompt + tool calls land as span attributes (not just
			//   token counts).
			//   `logPrompts=true` is what makes gemini-cli embed the actual
			//   user prompt text in the user_prompt event - without it the
			//   receiver-side fold has no input text to lift onto
			//   langwatch.input.value, same class as claude-code.
			return {
				GEMINI_TELEMETRY_ENABLED: "true",
				GEMINI_TELEMETRY_TARGET: "local",
				GEMINI_TELEMETRY_USE_COLLECTOR: "true",
				GEMINI_TELEMETRY_TRACES_ENABLED: "true",
				GEMINI_TELEMETRY_OTLP_PROTOCOL: "http",
				GEMINI_TELEMETRY_OTLP_ENDPOINT: endpoint,
				GEMINI_TELEMETRY_LOG_PROMPTS: "true",
				OTEL_TRACES_EXPORTER: "otlp",
				OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
				...base,
				OTEL_RESOURCE_ATTRIBUTES: "service.name=gemini-cli",
			};
		case "opencode":
			return {
				OTEL_TRACES_EXPORTER: "otlp",
				OTEL_LOGS_EXPORTER: "otlp",
				OTEL_METRICS_EXPORTER: "otlp",
				OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
				...base,
				OTEL_RESOURCE_ATTRIBUTES: "service.name=opencode",
			};
		case "copilot":
			// GitHub Copilot CLI (>= 1.0.41) native OTel, verified against the
			// 1.0.69 bundle string sweep:
			//   COPILOT_OTEL_ENABLED=1 unlocks export (setting the OTLP
			//     endpoint alone also enables it; both set for explicitness).
			//   COPILOT_OTEL_EXPORTER_TYPE accepts "otlp-http" (default) or
			//     "file". Pinned here because a user who previously wired the
			//     file exporter (the ccusage setup) has =file exported in their
			//     shell — inherited, it silently redirects ALL telemetry to a
			//     local JSONL file and Path B captures nothing (ADR-039 D5).
			//   OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true puts
			//     full prompt/response content on gen_ai.input.messages /
			//     gen_ai.output.messages span attributes — the ONLY surface
			//     carrying content (hook payloads and the stats footer are
			//     metadata-only). Capture-everything default per ADR-039; an
			//     explicit user "false" in the parent env is respected by the
			//     resolver (never overridden), with a tokens-only notice.
			//   Copilot emits spans + metrics only (no standalone log records),
			//   so no OTEL_LOGS_EXPORTER. Transport is otlp-http only; a grpc
			//   protocol value silently falls back, so http/json is pinned.
			return {
				COPILOT_OTEL_ENABLED: "true",
				COPILOT_OTEL_EXPORTER_TYPE: "otlp-http",
				OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: "true",
				OTEL_TRACES_EXPORTER: "otlp",
				OTEL_METRICS_EXPORTER: "otlp",
				OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
				...base,
				OTEL_RESOURCE_ATTRIBUTES: "service.name=copilot-cli",
			};
		case "code":
			// VS Code Copilot Chat extension (ADR-039 §Extension #2). Same OTel
			// GenAI export as the copilot CLI, enabled purely by env — the
			// COPILOT_OTEL_ENABLED env overrides the extension's default-false
			// `github.copilot.chat.otel.enabled` setting (spike-verified: an
			// env-only launch with an empty settings.json still captured a real
			// turn). service.name=copilot-chat is the extension's own resource
			// label and the sourceType discriminator on the wire. Ingestion-only:
			// the chat extension has no BYOK gateway env, so no Path A here.
			return {
				COPILOT_OTEL_ENABLED: "true",
				OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: "true",
				OTEL_TRACES_EXPORTER: "otlp",
				OTEL_METRICS_EXPORTER: "otlp",
				OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
				...base,
				OTEL_RESOURCE_ATTRIBUTES: "service.name=copilot-chat",
			};
		default:
			return base;
	}
}
