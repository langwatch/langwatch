/**
 * String/escape-aware scanning primitives for TRUNCATED JSON bodies.
 *
 * claude truncates large request bodies INLINE at ~60KB, so a real
 * coding-agent turn does not JSON.parse. Both truncation-recovery paths — the
 * canonicalisation extractor (flattened display messages) and the
 * block-classification body parser (structured classifier input) — rebuild
 * what survived the cut with these primitives. They live in ONE module because
 * the two paths must judge truncation identically: if their scanners drift,
 * the display and the classification disagree about which turns survived.
 *
 * Conventions shared by all three scanners: string state is tracked with an
 * escape flag, so braces/brackets/quotes inside string values never corrupt
 * the structural scan; a trailing element cut off by truncation never
 * completes and is never returned.
 */

/**
 * Index of `"key"` occurring as a KEY of the TOP-LEVEL object (depth 1,
 * outside strings, followed by `:`), or -1. A bare `indexOf('"system"')` can
 * be hijacked by the same key inside a `tool_use.input` payload — that input
 * is embedded as real unescaped JSON, so it false-matches before the real
 * top-level key.
 */
export function topLevelKeyIndex(raw: string, key: string): number {
  const needle = `"${key}"`;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      if (depth === 1 && raw.startsWith(needle, i)) {
        let j = i + needle.length;
        while (j < raw.length && /\s/.test(raw[j]!)) j++;
        if (raw[j] === ":") return i;
      }
      inStr = true;
      continue;
    }
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
  }
  return -1;
}

/**
 * Read a complete JSON string literal starting at `quoteIndex` (which must
 * point at the opening `"`), honouring escapes. Returns the unescaped value,
 * or null when the string was cut off by truncation (no closing quote).
 */
export function readJsonStringAt(
  raw: string,
  quoteIndex: number,
): string | null {
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
 * Yield every COMPLETE, balanced top-level `{…}` object slice at/after
 * `fromIndex`, tracking string/escape state so braces inside string values do
 * not corrupt the depth count. Stops at the first depth-0 `]` (the end of the
 * enclosing array) so a scan seeded at a `messages`/`system` array does not
 * bleed into sibling fields. A trailing object cut off by truncation never
 * balances and is never yielded.
 */
export function* completeObjectSlices(
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
