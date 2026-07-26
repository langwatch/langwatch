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
};

/**
 * The env var names langwatch persists for `tool`'s Path B telemetry.
 * Derived from the same builder that installs them, so the logout /
 * removal path can strip exactly the keys the install path wrote (no
 * drift). Values are irrelevant here, so placeholders are passed in.
 */
export function telemetryEnvVarNames(tool: string): string[] {
	return Object.keys(buildOtelEnvBlock(tool, "", ""));
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
		default:
			return base;
	}
}
