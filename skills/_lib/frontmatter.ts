export interface ParsedFrontmatter {
  frontmatter: Record<string, string>;
  body: string;
}

// Minimal `---`-delimited YAML frontmatter reader. Captures only top-level
// single-line `key: value` pairs — enough for skill metadata (name,
// description, license, compatibility). Nested keys (e.g. `metadata:`) are
// intentionally ignored; callers that need them should parse the body
// themselves. Shared by the docs/platform compiler and the native skill
// generator so both read frontmatter the same way.
export function splitFrontmatter(raw: string): ParsedFrontmatter {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { frontmatter: {}, body: raw };
  const fm: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const kv = line.match(/^(\w[\w-]*?):\s*(.+)$/);
    if (kv) fm[kv[1]!] = kv[2]!.trim();
  }
  return { frontmatter: fm, body: m[2]!.trim() };
}
