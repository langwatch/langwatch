/**
 * Structured Claude Code body → classifier input (ADR-033, capture-fidelity
 * Open Question).
 *
 * The Claude Code log path attaches the RAW Anthropic api_request_body /
 * api_response_body to the span (`langwatch.claude_code.request_body` /
 * `.response_body`). The lifted `langwatch.input` FLATTENS every message to plain
 * text, which strips `cache_control` and collapses tool_results — so classifying
 * from it needs a pool-inferred breakpoint and mis-types tool I/O. The raw body
 * is higher fidelity: it keeps the content-block structure, so parsing IT gives
 * the classifier a REAL cache_control breakpoint, correctly-typed tool_result
 * blocks, and structured output (thinking / tool_use) — no inference needed.
 *
 * Truncation-tolerant: claude truncates the body inline at ~60KB, so a real turn
 * does not JSON.parse. A string/escape-aware brace scan recovers the complete
 * leading message objects and the front-loaded system blocks that survived the
 * cut, WITH their block structure preserved (truncation always removes the tail).
 *
 * Pure: span-in / plain-object-out, no I/O.
 */

/** The classifier's input shape: Anthropic-style messages + the request tools. */
export interface ClaudeCodeStructuredInput {
  messages: Array<{ role: string; content: unknown }>;
  tools: unknown;
  /**
   * False when the body was truncated inline, so the recovered `messages` are
   * only the surviving leading prefix and the NEWEST turn (the tail, always the
   * first thing truncation drops) is missing. The caller then reinstates the
   * current turn from a clean side-channel (the co-located `user_prompt` /
   * `gen_ai.input.messages`) so the fresh user input is not lost. True on the
   * clean-parse path, where every turn — including the newest — survived.
   */
  newestTurnComplete: boolean;
}

/**
 * Parse the request body into `{ role, content }` messages (system first) plus
 * the `tools` array, preserving each message's content-block structure. Returns
 * null when the body is absent or nothing usable survives.
 */
export function parseClaudeCodeRequestBody(
  raw: unknown,
): ClaudeCodeStructuredInput | null {
  if (typeof raw !== "string" || raw.length === 0) return null;

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }

  if (parsed && typeof parsed === "object") {
    const obj = parsed as {
      system?: unknown;
      tools?: unknown;
      messages?: unknown;
    };
    const messages: Array<{ role: string; content: unknown }> = [];
    if (obj.system !== undefined) {
      messages.push({ role: "system", content: obj.system });
    }
    if (Array.isArray(obj.messages)) {
      for (const m of obj.messages) {
        if (!m || typeof m !== "object") continue;
        const msg = m as { role?: unknown; content?: unknown };
        messages.push({
          role: typeof msg.role === "string" ? msg.role : "user",
          content: msg.content,
        });
      }
    }
    if (messages.length === 0) return null;
    // Clean parse: the whole body (including the newest turn) survived.
    return { messages, tools: obj.tools, newestTurnComplete: true };
  }

  // Truncated body: recover complete leading message objects + system blocks,
  // structure intact. `tools` typically sit past the truncation point, so they
  // are usually unrecoverable — acceptable (the fold has no tools content
  // regardless); the cached prefix (system + early turns) is what matters. The
  // newest turn is the tail truncation drops, so newestTurnComplete is false and
  // the caller reinstates the current prompt from the clean side-channel.
  const messages = recoverStructuredMessages(raw);
  return messages
    ? { messages, tools: undefined, newestTurnComplete: false }
    : null;
}

/**
 * Parse the response body into a single assistant message whose content is the
 * raw block array (`text` / `tool_use` / `thinking`), so output classifies into
 * assistant_text / tool_call_* / thinking instead of a flat blob. Returns null
 * when absent or unparseable (the caller then falls back to the flat output).
 */
export function parseClaudeCodeResponseBody(
  raw: unknown,
): Array<{ role: string; content: unknown }> | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // a truncated response body: caller uses the flat reply text
  }
  if (!parsed || typeof parsed !== "object") return null;
  const content = (parsed as { content?: unknown }).content;
  if (!Array.isArray(content) || content.length === 0) return null;
  return [{ role: "assistant", content }];
}

/**
 * Recover complete `{ role, content }` message objects from a truncated request
 * body, keeping `content` as its raw structure. The front-loaded `system` value
 * is recovered first (string or content-block array), then the `messages` array
 * is scanned for complete objects before the cut.
 */
function recoverStructuredMessages(
  raw: string,
): Array<{ role: string; content: unknown }> | null {
  const out: Array<{ role: string; content: unknown }> = [];

  const system = recoverSystemValue(raw);
  if (system !== null) out.push({ role: "system", content: system });

  const messagesKey = raw.indexOf('"messages"');
  if (messagesKey >= 0) {
    const arrayStart = raw.indexOf("[", messagesKey);
    if (arrayStart >= 0) {
      for (const slice of completeObjectSlices(raw, arrayStart + 1)) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(slice);
        } catch {
          continue;
        }
        if (!parsed || typeof parsed !== "object") continue;
        const msg = parsed as { role?: unknown; content?: unknown };
        if (msg.content === undefined) continue;
        out.push({
          role: typeof msg.role === "string" ? msg.role : "user",
          content: msg.content,
        });
      }
    }
  }

  return out.length > 0 ? out : null;
}

/**
 * Recover the `system` value from a truncated body: a JSON string, or a
 * content-block array (recovered block-by-block if the array itself was cut).
 * Returns null when there is no system value or nothing parses.
 */
function recoverSystemValue(raw: string): unknown | null {
  const key = raw.indexOf('"system"');
  if (key < 0) return null;
  let i = raw.indexOf(":", key);
  if (i < 0) return null;
  i++;
  while (i < raw.length && /\s/.test(raw[i]!)) i++;
  if (i >= raw.length) return null;

  if (raw[i] === '"') {
    return readJsonStringAt(raw, i);
  }
  if (raw[i] === "[") {
    const blocks: unknown[] = [];
    for (const slice of completeObjectSlices(raw, i + 1)) {
      try {
        blocks.push(JSON.parse(slice));
      } catch {
        // skip a block that didn't parse
      }
    }
    return blocks.length > 0 ? blocks : null;
  }
  return null;
}

/** Read a complete JSON string literal at `quoteIndex`, or null if truncated. */
function readJsonStringAt(raw: string, quoteIndex: number): string | null {
  let esc = false;
  for (let i = quoteIndex + 1; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') {
      try {
        return JSON.parse(raw.slice(quoteIndex, i + 1)) as string;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Yield every complete, balanced top-level `{…}` object slice at/after
 * `fromIndex`, string/escape aware, stopping at the first depth-0 `]` so a scan
 * seeded at an array does not bleed into sibling fields. A trailing object cut
 * off by truncation never balances and is never yielded.
 */
function* completeObjectSlices(
  raw: string,
  fromIndex: number,
): Generator<string> {
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = fromIndex; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          yield raw.slice(start, i + 1);
          start = -1;
        }
      }
    } else if (ch === "]" && depth === 0) {
      return;
    }
  }
}
