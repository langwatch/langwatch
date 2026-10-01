function looksLikeXml(s: string): boolean {
  const t = s.trim();
  if (t.length === 0 || t[0] !== "<") return false;
  return /<([a-zA-Z][\w-]*)(\s[^>]*)?>[\s\S]*?<\/\1\s*>/.test(t);
}

function looksLikeJson(s: string): boolean {
  const t = s.trim();
  if (t.length === 0) return false;
  if (t[0] !== "{" && t[0] !== "[") return false;
  const last = t[t.length - 1];
  if (last !== "}" && last !== "]") return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

export function asMarkdownBody(content: string): string {
  if (looksLikeXml(content)) {
    return "```xml\n" + content + "\n```";
  }
  if (looksLikeJson(content)) {
    return "```json\n" + asPrettyJson(content) + "\n```";
  }
  return content;
}

export function asPrettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** The JSON document this string holds, or null when it does not hold one. */
export function parseJSON(s: string): unknown {
  const trimmed = s.trim();
  const opensJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  const closesJson = trimmed.endsWith("}") || trimmed.endsWith("]");
  if (!opensJson || !closesJson) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}
