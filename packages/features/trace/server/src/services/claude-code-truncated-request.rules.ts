import { contentToText, toolDefinitionsMessage } from "./claude-code-content.rules";
import { isRecord } from "./canonical-guard.rules";

/** claude appends this marker where it cut an oversized inline body. */
const CLAUDE_TRUNCATION_MARKER = /\s*\[TRUNCATED - [^\]]*\]\s*$/;

/**
 * Best-effort parse of a request body claude cut mid-JSON: a single scanner
 * pass finds the complete leading `messages` elements and the `system` /
 * `tools` values (whole or partial), and rebuilds the same message array the
 * intact path produces. Partial system text is kept and marked, for a
 * session past ~60KB of history the head of the system prompt is all that
 * survives the cap, and it is still what identifies the session's context.
 *
 * @internal exported for unit testing
 */
export function salvageTruncatedRequestBody(
  raw: string,
): Array<{ role: string; content: string }> | null {
  const trimmed = raw.replace(CLAUDE_TRUNCATION_MARKER, "");

  const system = salvageTopLevelValue(trimmed, "system");
  const tools = salvageTopLevelValue(trimmed, "tools");
  const messages = salvageTopLevelValue(trimmed, "messages");

  const out = [
    salvagedSystemMessage(system),
    toolDefinitionsMessage(salvagedArray(tools)),
    ...salvagedHistoryMessages(messages),
  ].filter((m): m is { role: string; content: string } => m !== null);

  if (out.length === 0) {
    return null;
  }
  if (messages?.isComplete !== true || system === null || !system.isComplete) {
    out.push({
      role: "system",
      content:
        "[request body truncated by claude's 60KB telemetry cap, later turns and remaining context omitted]",
    });
  }
  return out;
}

/** The `system` value, marked when the cut landed inside it. */
function salvagedSystemMessage(
  system: SalvagedValue | null,
): { role: string; content: string } | null {
  if (system === null) {
    return null;
  }
  const text = system.isComplete
    ? contentToText(safeParse(system.slice) ?? system.slice)
    : salvagePartialText(system.slice);
  if (!text || text.length === 0) {
    return null;
  }
  return {
    role: "system",
    content: system.isComplete
      ? text
      : `${text}\n\n[system prompt truncated by claude's 60KB telemetry cap]`,
  };
}

/** Every message that closed before the cut, in order. */
function salvagedHistoryMessages(
  messages: SalvagedValue | null,
): Array<{ role: string; content: string }> {
  const parsed = salvagedArray(messages);
  if (!Array.isArray(parsed)) {
    return [];
  }
  const out: Array<{ role: string; content: string }> = [];
  for (const entry of parsed) {
    if (!isRecord(entry)) {
      continue;
    }
    const { role, content } = entry;
    const text = contentToText(content);
    if (text.length === 0) {
      continue;
    }
    out.push({ role: typeof role === "string" ? role : "user", content: text });
  }
  return out;
}

/** A salvaged array value, parsed whole when it closed and element-wise when not. */
function salvagedArray(value: SalvagedValue | null): unknown {
  if (value === null) {
    return null;
  }
  return value.isComplete ? safeParse(value.slice) : salvageCompleteArrayElements(value.slice);
}

function safeParse(slice: string): unknown {
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

interface SalvagedValue {
  /** The raw character span of the value (complete or cut). */
  slice: string;
  /** Whether the value closed before the cut. */
  isComplete: boolean;
}

/**
 * What one character meant to a JSON scan. The walkers below each care about a
 * different subset, but all of them need string and escape state tracked
 * exactly right, which is the part that is easy to get subtly wrong, so it
 * lives in {@link JsonScan} once rather than three times.
 */
type JsonScanEvent =
  | "string-content"
  | "string-open"
  | "string-close"
  | "depth-in"
  | "depth-out"
  | "literal";

/**
 * A character cursor over (possibly cut) JSON that never allocates a parse
 * tree, so a 60KB body costs one linear pass. `depth` counts brackets and is
 * updated before the event is returned; a quote leaves it untouched, so a
 * caller reading `depth` on a string event sees the depth the string sits at.
 */
class JsonScan {
  depth = 0;
  private inString = false;
  private escaped = false;

  step(ch: string | undefined): JsonScanEvent {
    if (this.inString) {
      return this.stepInsideString(ch);
    }
    if (ch === '"') {
      this.inString = true;
      return "string-open";
    }
    if (ch === "{" || ch === "[") {
      this.depth++;
      return "depth-in";
    }
    if (ch === "}" || ch === "]") {
      this.depth--;
      return "depth-out";
    }
    return "literal";
  }

  private stepInsideString(ch: string | undefined): JsonScanEvent {
    if (this.escaped) {
      this.escaped = false;
      return "string-content";
    }
    if (ch === "\\") {
      this.escaped = true;
      return "string-content";
    }
    if (ch === '"') {
      this.inString = false;
      return "string-close";
    }
    return "string-content";
  }
}

/** Single-pass scan for a top-level key's value span in (possibly cut) JSON. */
function salvageTopLevelValue(raw: string, key: string): SalvagedValue | null {
  const needle = `"${key}":`;
  const scan = new JsonScan();
  for (let i = 0; i < raw.length; i++) {
    // Only a depth-1 quote can open a top-level key, and the check has to
    // happen before the step consumes the quote into string state.
    const atTopLevelKey = scan.depth === 1 && raw.startsWith(needle, i);
    if (scan.step(raw[i]) === "string-open" && atTopLevelKey) {
      return scanValueSpan(raw, i + needle.length);
    }
  }
  return null;
}

/**
 * The span of one JSON value starting at `start`, or its cut prefix. The value
 * is expected to be a string, object or array, which is what the three keys
 * salvage asks for always are; a bare scalar owns no delimiter to close on and
 * so reads as running to the end of the input.
 */
function scanValueSpan(raw: string, start: number): SalvagedValue {
  const scan = new JsonScan();
  for (let i = start; i < raw.length; i++) {
    const event = scan.step(raw[i]);
    const closed = event === "string-close" || event === "depth-out";
    if (closed && scan.depth === 0) {
      return { slice: raw.slice(start, i + 1), isComplete: true };
    }
  }
  return { slice: raw.slice(start), isComplete: false };
}

/**
 * The complete leading elements of a CUT array literal, the elements that
 * closed before the truncation point parse individually; the cut one is
 * dropped.
 */
function salvageCompleteArrayElements(slice: string): unknown[] {
  const elements: unknown[] = [];
  const scan = new JsonScan();
  let elementStart = -1;
  for (let i = 0; i < slice.length; i++) {
    const event = scan.step(slice[i]);
    if (event === "depth-in" && scan.depth === 2 && elementStart === -1) {
      elementStart = i;
    } else if (event === "depth-out" && scan.depth === 1 && elementStart >= 0) {
      const parsed = safeParse(slice.slice(elementStart, i + 1));
      if (parsed !== null) {
        elements.push(parsed);
      }
      elementStart = -1;
    }
  }
  return elements;
}

/**
 * The readable text out of a CUT string or content-block-array fragment:
 * for a string value the raw chars up to the cut (minus any dangling escape),
 * for an array of blocks the complete blocks' text plus the cut block's
 * partial `"text"` string.
 */
function salvagePartialText(slice: string): string | null {
  const fragment = slice.trimStart();
  if (fragment.startsWith('"')) {
    return decodePartialJsonString(fragment.slice(1));
  }
  if (fragment.startsWith("[")) {
    const parts = [
      contentToText(salvageCompleteArrayElements(fragment)),
      cutBlockText(fragment) ?? "",
    ].filter((part) => part.length > 0);
    return parts.length > 0 ? parts.join("\n\n") : null;
  }
  return null;
}

/** The last block's partial `"text"` value, when the cut landed inside it. */
function cutBlockText(fragment: string): string | null {
  const key = '"text":';
  const lastTextKey = fragment.lastIndexOf(key);
  if (lastTextKey === -1) {
    return null;
  }
  const afterKey = fragment.slice(lastTextKey + key.length).trimStart();
  if (!afterKey.startsWith('"') || isClosedString(afterKey)) {
    return null;
  }
  return decodePartialJsonString(afterKey.slice(1));
}

/** Whether a fragment starting at a quote closes its string. */
function isClosedString(fragment: string): boolean {
  let escaped = false;
  for (let i = 1; i < fragment.length; i++) {
    if (escaped) {
      escaped = false;
      continue;
    }
    const ch = fragment[i];
    if (ch === "\\") {
      escaped = true;
    } else if (ch === '"') {
      return true;
    }
  }
  return false;
}

/**
 * Decode the content of a JSON string cut before its closing quote: drop a
 * dangling escape (`\` or incomplete `\uXX`), close the quote, parse.
 */
function decodePartialJsonString(content: string): string | null {
  let body = content;
  // An unescaped closing quote means the string actually completed.
  const closed = isClosedString(`"${body}`);
  if (closed) {
    const end = `"${body}`.indexOf('"', 1);
    body = `"${body}`.slice(1, end);
  }
  // Trim a trailing incomplete \uXXXX escape, then a trailing lone backslash.
  body = body.replace(/\\u[0-9a-fA-F]{0,3}$/, "");
  let backslashes = 0;
  for (let i = body.length - 1; i >= 0 && body[i] === "\\"; i--) {
    backslashes++;
  }
  if (backslashes % 2 === 1) {
    body = body.slice(0, -1);
  }
  const parsed = safeParse(`"${body}"`);
  return typeof parsed === "string" && parsed.length > 0 ? parsed : null;
}
