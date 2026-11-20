/**
 * Claude Code's Code Mode gives the model two tools: REPL runs a JavaScript script, Poll waits
 * for one still running. The real tools run inside the script, so the transcript carries them
 * as their own entries marked `inScript`; these helpers read the two wrapper tools.
 */
const SCRIPT_TOOL = "REPL";
const POLL_TOOL = "Poll";

/** The keys of the outcome summary a tool span carries when no result content was exported. */
const OUTCOME_SUMMARY_KEYS = new Set([
  "status",
  "success",
  "durationMs",
  "resultSizeBytes",
  "decision",
  "decisionSource",
]);

/** The statuses the outcome summary is written with. */
const SUMMARY_STATUSES = new Set(["completed", "failed", "unknown", "rejected"]);

export function isCodeModeScript(name: string): boolean {
  return name === SCRIPT_TOOL;
}

export function isCodeModePoll(name: string): boolean {
  return name === POLL_TOOL;
}

export interface CodeModeScript {
  /** The short label the model gave the script; null when not exported. */
  description: string | null;
  /** The script's source; null on a metadata-only session. */
  code: string | null;
  lineCount: number | null;
}

export function readCodeModeScript(input: unknown): CodeModeScript {
  const record = input !== null && typeof input === "object" && !Array.isArray(input) ? input : {};
  const { code, description } = record as Record<string, unknown>;
  const source = typeof code === "string" && code.trim() !== "" ? code : null;

  return {
    description:
      typeof description === "string" && description.trim() !== "" ? description.trim() : null,
    code: source,
    lineCount: source === null ? null : source.replace(/\n+$/, "").split("\n").length,
  };
}

/**
 * The text the script handed back to the model, when the session recorded it. The status
 * summary the span carries otherwise says nothing the row does not, so it is never a body.
 */
export function codeModeResultText(output: unknown): string | null {
  if (typeof output !== "string" || output.trim() === "") return null;
  return isToolOutcomeSummary(output) ? null : output;
}

function isToolOutcomeSummary(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return false;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const record = parsed as Record<string, unknown>;
    // The span records no provenance, so the summary is told by its whole shape: a `status` the
    // enrichment writes plus only its own keys. A script's own `{ success: false }` keeps showing.
    return (
      typeof record.status === "string" &&
      SUMMARY_STATUSES.has(record.status) &&
      Object.keys(record).every((key) => OUTCOME_SUMMARY_KEYS.has(key))
    );
  } catch {
    return false;
  }
}
