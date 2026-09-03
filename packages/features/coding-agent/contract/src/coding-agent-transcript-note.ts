import type { TranscriptEntry } from "./coding-agent-transcript";
import { readNumber, readString } from "./coding-agent-transcript-value";

type NoteEntry = Extract<TranscriptEntry, { kind: "note" }>;

export function transcriptNoteEntry({
  event,
  attrs,
  atMs,
}: {
  event: string;
  attrs: Record<string, unknown>;
  atMs: number;
}): NoteEntry | null {
  switch (event) {
    case "compaction":
      return compactionEntry(attrs, atMs);
    case "permission_mode_changed":
      return note(atMs, "warning", event, approvalModeText(attrs));
    case "api_error":
      return note(atMs, "error", event, apiErrorText(attrs));
    case "retries_exhausted":
      return note(
        atMs,
        "error",
        event,
        "Gave up after retrying — whatever this was doing did not happen.",
      );
    case "session_error":
    case "internal_error":
      return note(atMs, "error", event, readString(attrs, "error") ?? "The session hit an error.");
    case "api_refusal":
      return note(atMs, "error", event, "The model refused to answer.");
    case "subtask_invoked":
      return note(atMs, "info", event, subtaskText(attrs));
    case "commit":
      return note(atMs, "info", event, commitText(attrs));
    case "skill_activated":
      return note(atMs, "info", event, skillText(attrs));
    default:
      return null;
  }
}

function note(atMs: number, level: NoteEntry["level"], event: string, text: string): NoteEntry {
  return { kind: "note", atMs, level, event, text };
}

function compactionEntry(attrs: Record<string, unknown>, atMs: number): NoteEntry {
  const pre = readNumber(attrs, "pre_tokens");
  const post = readNumber(attrs, "post_tokens");
  const trigger = readString(attrs, "trigger") ?? "auto";
  const text =
    pre !== null && post !== null
      ? `Context compacted (${trigger}): ${formatTokenCount(pre)} → ${formatTokenCount(post)} tokens`
      : `Context compacted (${trigger})`;

  return note(atMs, "info", "compaction", text);
}

function approvalModeText(attrs: Record<string, unknown>): string {
  const mode = readString(attrs, "to_mode") ?? "unknown";
  return `Approval mode changed to ${mode}.`;
}

function apiErrorText(attrs: Record<string, unknown>): string {
  const status = readString(attrs, "status_code");
  if (status === "429") return "Rate limited by the provider.";
  return `The request failed${status ? ` (${status})` : ""}.`;
}

function subtaskText(attrs: Record<string, unknown>): string {
  const description = readString(attrs, "description");
  return description ? `Sub-agent spawned: ${description}` : "A sub-agent was spawned.";
}

function commitText(attrs: Record<string, unknown>): string {
  const message = readString(attrs, "message");
  return message ? `Commit created: ${message}` : "A commit was created.";
}

function skillText(attrs: Record<string, unknown>): string {
  const skill = readString(attrs, "skill_name") ?? readString(attrs, "skill");
  return skill ? `Skill activated: ${skill}` : "A skill was activated.";
}

function formatTokenCount(value: number): string {
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
}
