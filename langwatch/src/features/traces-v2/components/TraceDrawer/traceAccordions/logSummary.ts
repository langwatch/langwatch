import type { TraceLogRecordDto } from "~/server/api/routers/tracesV2";
import {
  normalizeEventName,
  type CodingAgentEvent,
} from "~/server/event-sourcing/pipelines/trace-processing/projections/services/coding-agent-normalization";

/**
 * A one-line, human summary for a log record whose `event.name` is one of the
 * canonical coding-agent events — the same vocabulary `coding-agent-transcript
 * .derivation.ts` normalizes across Claude Code, opencode, Codex, Gemini CLI
 * and Copilot. Returns null for a log we don't have a name for, so the Logs
 * section falls back to a generic attribute dump rather than a misleading
 * label.
 *
 * Deliberately exhaustive over `CodingAgentEvent` (not a subset) — the
 * transcript derivation only renders the events worth putting IN a
 * conversation replay (a `tool_decision` the user accepted is redundant with
 * its span, so the transcript drops it); a span's raw Logs section has no
 * such reason to hide anything it actually received.
 */
export function summarizeLogEvent(log: TraceLogRecordDto): string | null {
  const event = normalizeEventName(log.attributes["event.name"]);
  if (event === null) return null;
  return describe(event, log.attributes);
}

function describe(event: CodingAgentEvent, attrs: Record<string, string>): string {
  switch (event) {
    case "user_prompt":
      return `User sent a prompt (${attrs.prompt_length ?? attrs.prompt?.length ?? "?"} chars)`;
    case "assistant_response":
      return `Assistant replied${attrs.model ? ` (${attrs.model})` : ""}`;
    case "api_request":
      return "Model call started";
    case "api_error": {
      const status = attrs.status_code;
      return status === "429"
        ? "Rate limited by the provider"
        : `API call failed${status ? ` (${status})` : ""}`;
    }
    case "api_refusal":
      return "The model refused this request";
    case "retries_exhausted":
      return `Gave up after retrying${attrs.total_attempts ? ` (${attrs.total_attempts} attempts)` : ""}`;
    case "tool_result":
      return `Tool ran${attrs.tool_name ? `: ${attrs.tool_name}` : ""}`;
    case "tool_decision": {
      const decision = attrs.decision ?? "unknown";
      const tool = attrs.tool_name ?? "a tool";
      if (decision === "accept") return `Approved ${tool}`;
      return `Denied ${tool}${attrs.source ? ` (${attrs.source})` : ""}`;
    }
    case "compaction":
      return attrs.pre_tokens && attrs.post_tokens
        ? `Context compacted: ${formatCount(attrs.pre_tokens)} → ${formatCount(attrs.post_tokens)} tokens`
        : "Context compacted";
    case "permission_mode_changed":
      return `Approval mode changed to ${attrs.to_mode ?? "unknown"}`;
    case "skill_activated":
      return `Skill activated${attrs.name ? `: ${attrs.name}` : ""}`;
    case "mcp_server_connection":
      return `Connected to MCP server${attrs.name ? `: ${attrs.name}` : ""}`;
    case "hook_execution_complete":
      return `Hook ran${attrs.name ? `: ${attrs.name}` : ""}`;
    case "at_mention":
      return `@-mentioned${attrs.target ? ` ${attrs.target}` : " a file"}`;
    case "internal_error":
      return attrs.error ? `Internal error: ${attrs.error}` : "The session hit an internal error";
    case "session_created":
      return "Session started";
    case "session_idle":
      return "Session went idle";
    case "session_error":
      return attrs.error ? `Session error: ${attrs.error}` : "The session hit an error";
    case "subtask_invoked":
      return `Sub-agent invoked${attrs.subagent_type ? `: ${attrs.subagent_type}` : ""}`;
    case "commit":
      return "Commit created";
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

function formatCount(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}
