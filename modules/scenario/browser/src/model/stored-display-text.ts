/**
 * Stored content as the text a preview would show: a string, or the text
 * parts of a content array (stored as JSON). A START row holds "".
 */
export function storedDisplayText(content: unknown): string {
  if (typeof content === "string") {
    if (!content.startsWith("[")) return content.trim();
    try {
      return storedDisplayText(JSON.parse(content));
    } catch {
      return content.trim();
    }
  }
  if (!Array.isArray(content)) return "";
  return content.map(textOfPart).join("").trim();
}

function textOfPart(part: unknown): string {
  if (typeof part !== "object" || part === null) return "";
  if (!("type" in part) || part.type !== "text") return "";
  return "text" in part && typeof part.text === "string" ? part.text : "";
}
