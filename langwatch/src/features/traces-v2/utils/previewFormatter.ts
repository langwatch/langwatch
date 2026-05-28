/**
 * Single-source preview formatter for the trace explorer's truncated I/O
 * surfaces (table cell, group preview, conversation-context strip, system
 * prompt banner).
 *
 * The codebase had four separate paths into "render this content as a one-
 * line preview" — `tryParseChat`, `extractReadableSnippet`, `truncateText`,
 * raw `lineClamp`. Each one solved a different subset of the formatting
 * problems and the surfaces leaked the rest:
 *
 *   - `\`\`\`python\n…\n\`\`\`` → fences shown literally, eating preview width.
 *   - `{"question":"…"}` → JSON envelope shown verbatim instead of unwrapped.
 *   - `![](url)` → markdown image rendered as raw `![](…)`.
 *   - `\n` inside a `whitespace: nowrap` cell → collapsed silently, the
 *     reader can't tell the original was multi-line.
 *
 * `formatPreview` runs the full pipeline once and returns a single result
 * shape, so each preview surface just calls it. Failure-soft at every step:
 * if any part of the pipeline can't make sense of the input, we keep going
 * with what we have. Returning the raw input (truncated) is always a valid
 * outcome — a worse-but-correct preview is better than a thrown error.
 */

import { splitLeadingContextBlocks } from "./leadingContext";

const ELLIPSIS = "…";
const NEWLINE_GLYPH = "↵"; // ↵

/**
 * Single-key JSON envelopes worth unwrapping. Matched against the *only* key
 * of the object — multi-key objects keep their JSON shape.
 *
 * Scoped to keys whose value is reliably user-meaningful prose (the kind a
 * preview should surface). `id`, `name`, etc. are intentionally excluded:
 * unwrapping `{"id":"abc"}` to `"abc"` would lose the structural signal
 * that the trace's input *was* an envelope of an id, which is itself
 * meaningful in some integrations.
 */
const UNWRAP_KEY_ALLOWLIST = new Set([
  "question",
  "input",
  "prompt",
  "query",
  "text",
  "content",
  "message",
]);

/** ChatMessage shape we recognise in chat-array unwrapping. */
interface ChatMessageLike {
  role?: string;
  content?: unknown;
  /**
   * Genkit / AI SDK / Mastra emit a `parts` array (sibling of `content`),
   * where each part is `{ type: "text" | "blob" | "reasoning" | ..., content? | text? }`.
   * The backend's `extractMessageContentText` handles this shape; without
   * the matching support here, the new traces explorer renders these
   * payloads as raw JSON. Reported on 2026-05-14 by rchaves with a real
   * G'nger product-classification trace.
   */
  parts?: unknown;
  tool_calls?: Array<{ function?: { name?: string } }>;
}

export type NewlineTreatment = "glyph" | "space" | "preserve";

export interface PreviewOptions {
  /** Hard cap on output length (post-pipeline). */
  maxChars: number;
  /**
   * How to render newlines that survive unwrap + fence-strip:
   *  - "glyph": replace each run of \n with " ↵ " so the reader sees
   *    structure existed, but the text still flows as one line. Default
   *    for nowrap surfaces (table cell, group preview, conv context).
   *  - "space": collapse all whitespace runs to a single space. Calmer
   *    visual, loses the "this was multi-line" signal.
   *  - "preserve": keep \n verbatim. For surfaces with `pre-wrap` CSS
   *    that actually want to break lines (system prompt banner).
   */
  newlines?: NewlineTreatment;
  /**
   * When true, strip ```lang\n…\n``` fences (keeping the body) and replace
   * `![alt](url)` with "📷 alt". Default true. Disable for surfaces that
   * render their own markdown.
   */
  stripMarkdownNoise?: boolean;
}

export interface PreviewResult {
  /** The formatted, truncated string ready for direct rendering. */
  text: string;
  /**
   * If chat-array unwrapping picked a message, the role of that message.
   * Lets callers prefix `USER` / `ASSISTANT` chips next to the preview.
   */
  role?: "user" | "assistant" | "system" | "tool";
  /** A fenced code block was discarded during noise-strip. */
  hadCode?: boolean;
  /** A markdown image was discarded during noise-strip. */
  hadImage?: boolean;
}

/**
 * Format an input/output payload for one-line / short-block preview.
 * `null` / empty input → `{ text: "" }`.
 */
export function formatPreview(
  raw: string | null | undefined,
  options: PreviewOptions,
): PreviewResult {
  if (!raw) return { text: "" };

  const noiseStrip = options.stripMarkdownNoise ?? true;
  const newlines = options.newlines ?? "glyph";

  // Pipeline state — each step mutates `text` and may set role/hadCode/hadImage.
  let text = raw;
  let role: PreviewResult["role"];
  let hadCode = false;
  let hadImage = false;

  // 1. JSON unwrap. Only attempt when the trimmed input *looks* like JSON,
  //    so we don't waste cycles on every plain-string preview.
  const trimmed = text.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    const unwrap = unwrapJson(trimmed);
    if (unwrap) {
      text = unwrap.text;
      role = unwrap.role;
    }
  }

  // 1b. Strip leading XML-context blocks (Claude Code prepends
  //     <system-reminder> / MCP-instruction / skills-list tags above the
  //     human text). Only strip when real prose follows, so a message that
  //     is *only* tags stays visible rather than collapsing to empty.
  const contextSplit = splitLeadingContextBlocks(text);
  if (contextSplit.context && contextSplit.body.trim()) {
    text = contextSplit.body;
  }

  // 2. Markdown noise strip — fences + images. Runs after unwrap so a
  //    JSON-wrapped fenced code block (rare but real) gets normalised first.
  if (noiseStrip) {
    const stripped = stripMarkdownNoise(text);
    text = stripped.text;
    hadCode = stripped.hadCode;
    hadImage = stripped.hadImage;
  }

  // 3. Newline treatment.
  text = applyNewlineTreatment(text, newlines);

  // 4. Trim, hard-cap.
  text = text.trim();
  if (text.length > options.maxChars) {
    text = text.slice(0, options.maxChars - 1).trimEnd() + ELLIPSIS;
  }

  return { text, role, hadCode, hadImage };
}

// ---------------------------------------------------------------------------
// JSON unwrap: chat arrays, Anthropic typed blocks, single-key envelopes.

interface UnwrapResult {
  text: string;
  role?: PreviewResult["role"];
}

function unwrapJson(trimmed: string): UnwrapResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (Array.isArray(parsed)) {
    return unwrapChatArray(parsed);
  }
  if (parsed && typeof parsed === "object") {
    return unwrapObject(parsed as Record<string, unknown>);
  }
  return null;
}

/**
 * Walk a chat-shaped array (most-recent-first) and return the text of the
 * last message that has any. Tool calls render as `toolName(...)` so the
 * preview shows what the model did, not just an empty content field.
 */
function unwrapChatArray(arr: unknown[]): UnwrapResult | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    const msg = arr[i];
    if (!msg || typeof msg !== "object") continue;
    const m = msg as ChatMessageLike;
    const toolName = m.tool_calls?.[0]?.function?.name;
    if (toolName) {
      return {
        text: `${toolName}(...)`,
        role: normaliseRole(m.role),
      };
    }
    // Try `content` first (OpenAI / Anthropic), then `parts` (Genkit /
    // AI SDK / Mastra). Either may carry the readable payload, and
    // some integrations populate both — content wins when present.
    const content = extractMessageContent(m.content);
    if (content) {
      return { text: content, role: normaliseRole(m.role) };
    }
    if (Array.isArray(m.parts)) {
      const fromParts = extractMessagePartsText(m.parts);
      if (fromParts) {
        return { text: fromParts, role: normaliseRole(m.role) };
      }
    }
  }
  return null;
}

/**
 * Pull text out of a `parts` array. Each part is typically one of:
 *   - `{ type: "text", content: "..." }`  ← Genkit / Mastra
 *   - `{ type: "text", text: "..." }`     ← Anthropic style
 *   - `{ type: "blob" | "image" | "reasoning" | ... }` ← skip; non-text
 *   - `{ content: "..." }` / `{ text: "..." }` ← typeless wrapper
 *   - plain string                            ← rare; pass through
 *
 * Skips non-text parts so a multi-modal message (image + text)
 * surfaces just the text in a one-line preview. Non-text parts that
 * *are* the whole content (e.g. an image-only message) intentionally
 * yield no preview — fall-through to JSON.stringify keeps the wrapper
 * visible rather than rendering "(blob)" placeholders that the caller
 * couldn't distinguish from a real text "(blob)".
 */
// Typed `parts` entries we treat as user-meaningful prose. `text` covers
// Anthropic / Genkit / Mastra and AI SDK v4. `reasoning` is AI SDK v5
// where the model's chain-of-thought lands in a sibling part with its
// own `.text` string — same wire shape, different `type`. Skipping it
// would re-introduce the wrapper-JSON failure mode this PR is fixing,
// just for the next payload generation.
const RENDERABLE_PART_TYPES = new Set(["text", "reasoning"]);

function extractMessagePartsText(parts: unknown[]): string | null {
  const texts: string[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      texts.push(part);
      continue;
    }
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: unknown; text?: unknown; content?: unknown };

    // Typed part: only renderable types contribute to the preview.
    if (typeof p.type === "string") {
      if (!RENDERABLE_PART_TYPES.has(p.type)) continue;
      if (typeof p.text === "string") {
        texts.push(p.text);
      } else if (typeof p.content === "string") {
        texts.push(p.content);
      }
      continue;
    }

    // Typeless part: accept text or content directly.
    if (typeof p.text === "string") {
      texts.push(p.text);
    } else if (typeof p.content === "string") {
      texts.push(p.content);
    }
  }
  return texts.length > 0 ? texts.join(" ") : null;
}

/**
 * Object unwrap: prefer Anthropic-typed blocks, fall back to single-key
 * envelopes, otherwise stringify so we still produce *something*.
 */
function unwrapObject(obj: Record<string, unknown>): UnwrapResult {
  // Anthropic typed block at the top level.
  if (obj.type === "text" && typeof obj.text === "string") {
    return { text: obj.text };
  }
  if (typeof obj.type === "string" && obj.type !== "text") {
    // tool_use, tool_result, thinking, etc. — these rarely make readable
    // previews on their own. Surface a tag so the user knows there *was*
    // content but it wasn't text.
    return { text: `<${obj.type}>` };
  }

  // Single-key envelope from the allowlist.
  const keys = Object.keys(obj);
  if (keys.length === 1) {
    const key = keys[0]!;
    if (UNWRAP_KEY_ALLOWLIST.has(key.toLowerCase())) {
      const value = obj[key];
      if (typeof value === "string") return { text: value };
      if (typeof value === "number" || typeof value === "boolean") {
        return { text: String(value) };
      }
    }
  }

  // Fallback: stringify with no indent so it fits a one-liner.
  try {
    return { text: JSON.stringify(obj) };
  } catch {
    return { text: "" };
  }
}

/** Pull a string out of a chat message's `content` field (string | array). */
function extractMessageContent(content: unknown): string {
  if (typeof content === "string") {
    // The string might itself be a typed-block JSON — try one more unwrap.
    const t = content.trim();
    if (t.startsWith('{"type":"text"')) {
      try {
        const inner = JSON.parse(t) as { text?: string };
        if (typeof inner.text === "string") return inner.text;
      } catch {
        /* fall through */
      }
    }
    if (t.startsWith('{"type":"') && !t.startsWith('{"type":"text"')) {
      // Non-text typed block — nothing readable.
      return "";
    }
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        parts.push(part);
      } else if (
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        parts.push((part as { text: string }).text);
      }
    }
    return parts.join(" ");
  }
  return "";
}

function normaliseRole(role: unknown): PreviewResult["role"] {
  if (
    role === "user" ||
    role === "assistant" ||
    role === "system" ||
    role === "tool"
  ) {
    return role;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Markdown noise strip.

interface NoiseStripResult {
  text: string;
  hadCode: boolean;
  hadImage: boolean;
}

/**
 * Drop ```lang\n…\n``` fence wrappers (keeping the code body) and replace
 * `![alt](url)` images with a `📷 alt` token. The *language hint* on a
 * fence (`python`, `json`) is dropped — at preview width it's noise.
 *
 * Only the fences themselves are stripped, not inline backticks: ``foo``
 * inside running prose is fine to keep.
 */
function stripMarkdownNoise(text: string): NoiseStripResult {
  let hadCode = false;
  let hadImage = false;

  // Multi-line fenced code block: ```lang\n…\n```. Drop the fences + lang
  // hint, keep the body. Non-greedy match handles multiple blocks per
  // input. Split-and-rejoin avoids regex re-entry on tricky inputs.
  const FENCE_RE = /```(?:[a-zA-Z0-9_+-]*)\n([\s\S]*?)\n?```/g;
  text = text.replace(FENCE_RE, (_match, body: string) => {
    hadCode = true;
    return body;
  });

  // Image: ![alt](url) → "📷 alt" (or "📷" when alt is empty). Strict
  // single-line match — multi-line `![alt](\n  url\n)` is rare and would
  // break the preview anyway.
  const IMAGE_RE = /!\[([^\]]*)\]\([^)]*\)/g;
  text = text.replace(IMAGE_RE, (_m, alt: string) => {
    hadImage = true;
    return alt.trim() ? `\u{1F4F7} ${alt.trim()}` : "\u{1F4F7}";
  });

  return { text, hadCode, hadImage };
}

// ---------------------------------------------------------------------------
// Newline treatment.

function applyNewlineTreatment(text: string, mode: NewlineTreatment): string {
  if (mode === "preserve") return text;
  if (mode === "space") return text.replace(/\s+/g, " ");
  // glyph: collapse runs of newline-containing whitespace to "↵" surrounded
  // by a non-breaking space on the LEFT and a regular space on the RIGHT.
  // Using a regular space on both sides let the CSS line-wrap break BEFORE
  // the glyph, which read as "line two starts with ↵" — visually wrong.
  // Gluing the glyph to the preceding word keeps it where the line break
  // actually happened. The trailing space stays breakable so the next word
  // can flow onto a new line cleanly.
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n+\s*/g, ` ${NEWLINE_GLYPH} `)
    .trim();
}
