/**
 * Coerce trace input/output (JSON or plain text) to a single readable string
 * for the comfortable column view. Mirrors the IOPreview parser, but always
 * returns a string (no chat/tool flags).
 */
export function contentToText(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.role) {
      const last = parsed[parsed.length - 1];
      if (last.tool_calls) {
        const fn = last.tool_calls[0]?.function?.name ?? "tool";
        return `${fn}(...)`;
      }
      return contentPartsToString(last.content);
    }
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return JSON.stringify(parsed);
    }
  } catch {
    // not JSON
  }
  return raw;
}

function contentPartsToString(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (
          part &&
          typeof part === "object" &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          return (part as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return JSON.stringify(content);
}
