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
    return "```json\n" + tryPrettyJson(content) + "\n```";
  }
  return content;
}

export function tryPrettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function tryParseJSON(s: string): unknown | null {
  try {
    const trimmed = s.trim();
    if (
      (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
      (trimmed.endsWith("}") || trimmed.endsWith("]"))
    ) {
      return JSON.parse(trimmed);
    }
    return null;
  } catch {
    return null;
  }
}
