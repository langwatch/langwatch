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

/** A transcript entry as far as telling a metadata-only session goes. */
type SessionEntry = Readonly<{ kind: string; name?: unknown; input?: unknown; text?: unknown }>;

/**
 * Whether a Code Mode session was exported without content: it ran scripts, none of them
 * carries its source, and no prompt carries text. Its rows then say so once, not on each line.
 */
export function isMetadataOnlySession(entries: readonly SessionEntry[]): boolean {
  const scripts = entries.filter(
    (entry) =>
      entry.kind === "tool" && typeof entry.name === "string" && isCodeModeScript(entry.name),
  );
  if (scripts.length === 0) return false;
  if (scripts.some((entry) => readCodeModeScript(entry.input).code !== null)) return false;
  return !entries.some(
    (entry) =>
      entry.kind === "user_prompt" && typeof entry.text === "string" && entry.text.trim() !== "",
  );
}

export interface CodeModeScript {
  /** The short label the model gave the script; null when not exported. */
  description: string | null;
  /** The script's source; null on a metadata-only session. */
  code: string | null;
  lineCount: number | null;
  /** The script's full length when Claude Code's telemetry kept only its start; else null. */
  cutFromChars: number | null;
}

/** Claude Code's telemetry keeps the first 128 characters of a long value and appends this. */
const CUT_MARKER = /\u2026\[(\d+) chars\]$/;

export function readCodeModeScript(input: unknown): CodeModeScript {
  const record = input !== null && typeof input === "object" && !Array.isArray(input) ? input : {};
  const { code, description } = record as Record<string, unknown>;
  const raw = typeof code === "string" && code.trim() !== "" ? code : null;
  const cut = raw === null ? null : CUT_MARKER.exec(raw);
  const source = raw === null || cut === null ? raw : raw.slice(0, cut.index);

  return {
    description:
      typeof description === "string" && description.trim() !== "" ? description.trim() : null,
    code: source,
    lineCount: source === null ? null : source.replace(/\n+$/, "").split("\n").length,
    cutFromChars: cut === null ? null : Number(cut[1]),
  };
}

/** What a script handed back, read off a REPL or Poll output. */
export interface CodeModeScriptResult {
  /** The script's number in the session (`eval="3"`); null when the output names none. */
  evalNumber: number | null;
  /** The event's status, such as `settled`; null on a plain text result. */
  status: string | null;
  /** How long the script ran, in milliseconds; null when not recorded. */
  durationMs: number | null;
  text: string;
  isError: boolean;
}

/** The REPL call's answer while the script keeps running; a later Poll carries the result. */
const DISPATCH_RECEIPT = /^\(dispatched #\d+\)$/;
/** Harness text around the events: the nonce notice and the tool summary. */
const HARNESS_ELEMENTS = /<(system|tools-used-before-summary)>[\s\S]*?<\/\1>/g;
/** Only the harness's own script event, never an `<event>` a script printed. */
const SCRIPT_EVENT_ELEMENT = /<event\b([^>]*(?<![\w-])kind="repl-eval"[^>]*)>([\s\S]*?)<\/event>/g;
const EVENT_ATTRIBUTE = /([\w-]+)="([^"]*)"/g;

/**
 * The results a REPL or Poll output carries, oldest first: each settled script event's
 * `<result>` or `<error>` body, or the whole text a script returned. Null when the output is
 * the span's status summary, a dispatch receipt, or empty: none of those is a result.
 */
export function readCodeModeScriptResults(output: unknown): CodeModeScriptResult[] | null {
  const text = codeModeResultText(output);
  if (text === null || DISPATCH_RECEIPT.test(text.trim())) return null;

  const withoutHarness = text.replace(HARNESS_ELEMENTS, "");
  const events = [...withoutHarness.matchAll(SCRIPT_EVENT_ELEMENT)];
  if (events.length > 0) {
    return events.map(([, attrs = "", body = ""]) => readScriptEvent({ attrs, body }));
  }

  const plain = withoutHarness.trim();
  if (plain === "") return null;
  return [{ evalNumber: null, status: null, durationMs: null, text: plain, isError: false }];
}

function readScriptEvent({ attrs, body }: { attrs: string; body: string }): CodeModeScriptResult {
  const fields = new Map([...attrs.matchAll(EVENT_ATTRIBUTE)].map(([, k = "", v = ""]) => [k, v]));
  const error = /<error>([\s\S]*?)<\/error>/.exec(body);
  const result = /<result>([\s\S]*?)<\/result>/.exec(body);
  const evalNumber = Number(fields.get("eval"));
  const durationMs = Number(fields.get("ms"));

  return {
    evalNumber: fields.has("eval") && Number.isFinite(evalNumber) ? evalNumber : null,
    status: fields.get("status") ?? null,
    durationMs: fields.has("ms") && Number.isFinite(durationMs) ? durationMs : null,
    text: trimBlankLines((error ?? result)?.[1] ?? body),
    isError: error !== null,
  };
}

function trimBlankLines(text: string): string {
  return text.replace(/^\s*\n/, "").replace(/\s+$/, "");
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
