import type { LogRecordReceivedEventData } from "../../schemas/events";
import type { NormalizedSpan } from "../../schemas/spans";

/**
 * Claude-Code-specific facts about an interaction, folded onto the trace.
 *
 * The generic `langwatch.interaction.*` counts say how MUCH happened. These say
 * what KIND of thing it was, and they are the facts you cannot reconstruct from
 * a prompt-and-reply pair:
 *
 * - **`stop_reason`** is the load-bearing one. A reply that stopped on
 *   `max_tokens` or `refusal` is NOT an answer — it is a truncation. Rendered as
 *   the trace's "output" it reads as though the agent finished, when it was cut
 *   off. Nothing else in the trace tells you this.
 * - **`slash_command`** — the interaction may not have started with prose at all
 *   but with `/review`, `/commit`. That is the real intent.
 * - **`skills`** / **`subagent_types`** — WHICH skills and agents ran, not just
 *   how many.
 * - **`compacted`** — the context was compacted mid-interaction, so the model
 *   answered from a summary rather than the real history. A frequent cause of
 *   "why did it forget?".
 * - **`api_errors`** — the model call failed and was retried. Invisible in the
 *   spans, since a failed call has no successful span.
 * - **`permission_mode`** — `bypassPermissions` vs `plan` changes what the agent
 *   was even allowed to do.
 *
 * These fold from BOTH spans and logs, because Claude splits them: `stop_reason`
 * rides the span, the slash command and compaction ride the logs. Stamped as
 * ordinary trace-summary attributes so they stay queryable.
 */
const LLM_REQUEST_SPAN = "claude_code.llm_request";
const TOOL_SPAN = "claude_code.tool";
const INTERACTION_SPAN = "claude_code.interaction";

export const CLAUDE_ATTRS = {
  /** end_turn | tool_use | max_tokens | stop_sequence | pause_turn | refusal */
  STOP_REASON: "langwatch.claude_code.stop_reason",
  /** True when the reply was cut off rather than finished. */
  TRUNCATED: "langwatch.claude_code.truncated",
  /** The slash command that opened the interaction, if any. */
  SLASH_COMMAND: "langwatch.claude_code.slash_command",
  /** Skills activated, e.g. `["code-review"]`. */
  SKILLS: "langwatch.claude_code.skills",
  /** Sub-agent types spawned, e.g. `["Explore","general-purpose"]`. */
  SUBAGENT_TYPES: "langwatch.claude_code.subagent_types",
  /** The context was compacted mid-interaction. */
  COMPACTED: "langwatch.claude_code.compacted",
  /** Model calls that failed (and were retried). */
  API_ERRORS: "langwatch.claude_code.api_errors",
  /** default | plan | acceptEdits | auto | bypassPermissions */
  PERMISSION_MODE: "langwatch.claude_code.permission_mode",
  /** Which interaction this is within its session (1-based). */
  SEQUENCE: "langwatch.claude_code.interaction_sequence",
} as const;

/** A reply that stopped for one of these did NOT finish answering. */
const TRUNCATING_STOP_REASONS = new Set(["max_tokens", "refusal"]);

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readInt(attributes: Record<string, string>, key: string): number {
  const n = Number(attributes[key] ?? "0");
  return Number.isFinite(n) ? n : 0;
}

function readList(attributes: Record<string, string>, key: string): string[] {
  const raw = attributes[key];
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

/** Add `value` to a JSON string-set attribute, if not already there. */
function addToList(
  attributes: Record<string, string>,
  key: string,
  value: string,
): Record<string, string> {
  const list = readList(attributes, key);
  if (list.includes(value)) return {};
  return { [key]: JSON.stringify([...list, value]) };
}

/** Fold one SPAN into the Claude-specific trace facts. */
export function accumulateClaudeSummaryFromSpan({
  attributes,
  span,
}: {
  attributes: Record<string, string>;
  span: NormalizedSpan;
}): Record<string, string> {
  if (span.name === INTERACTION_SPAN) {
    const sequence = str(span.spanAttributes["interaction.sequence"]);
    return sequence !== null ? { [CLAUDE_ATTRS.SEQUENCE]: sequence } : {};
  }

  if (span.name === TOOL_SPAN) {
    const subagentType = str(span.spanAttributes.subagent_type);
    if (subagentType !== null) {
      return addToList(attributes, CLAUDE_ATTRS.SUBAGENT_TYPES, subagentType);
    }
    // A skill can reach the trace two ways: the `skill_activated` log event, and
    // the Skill TOOL span's `skill_name`. Read both — a skill Claude invoked
    // proactively arrives on one path, a `/slash` skill on the other, and taking
    // only one silently loses half of them.
    const skillName = str(span.spanAttributes.skill_name);
    return skillName !== null
      ? addToList(attributes, CLAUDE_ATTRS.SKILLS, skillName)
      : {};
  }

  if (span.name !== LLM_REQUEST_SPAN) return {};

  // The LAST model call's stop_reason is the interaction's: the earlier ones all
  // stop on `tool_use` by definition (that is what drove the loop onward), so
  // taking any but the last would report every agentic interaction as
  // unfinished. Last-write-wins across the fold gives us the final call's.
  const stopReason = str(span.spanAttributes.stop_reason);
  if (stopReason === null) return {};

  const next: Record<string, string> = {
    [CLAUDE_ATTRS.STOP_REASON]: stopReason,
  };
  // A reply cut off by max_tokens (or refused) is not an answer. Without this
  // the trace's "output" reads as though the agent finished.
  next[CLAUDE_ATTRS.TRUNCATED] = String(TRUNCATING_STOP_REASONS.has(stopReason));
  return next;
}

/** Fold one LOG RECORD into the Claude-specific trace facts. */
export function accumulateClaudeSummaryFromLog({
  attributes,
  data,
}: {
  attributes: Record<string, string>;
  data: LogRecordReceivedEventData;
}): Record<string, string> {
  const attrs = data.attributes;
  const eventName = str(attrs["event.name"]);
  if (eventName === null) return {};

  if (eventName === "user_prompt") {
    const command = str(attrs.command_name);
    return command !== null ? { [CLAUDE_ATTRS.SLASH_COMMAND]: command } : {};
  }

  if (eventName === "skill_activated") {
    const skill = str(attrs["skill.name"]);
    return skill !== null
      ? addToList(attributes, CLAUDE_ATTRS.SKILLS, skill)
      : {};
  }

  if (eventName === "compaction") {
    return { [CLAUDE_ATTRS.COMPACTED]: "true" };
  }

  if (eventName === "api_error") {
    return {
      [CLAUDE_ATTRS.API_ERRORS]: String(
        readInt(attributes, CLAUDE_ATTRS.API_ERRORS) + 1,
      ),
    };
  }

  if (eventName === "permission_mode_changed") {
    const mode = str(attrs.to_mode);
    return mode !== null ? { [CLAUDE_ATTRS.PERMISSION_MODE]: mode } : {};
  }

  return {};
}
