/**
 * Flattens Anthropic-format message content (string or content-block array)
 * to readable text. Shared by the scenario agent adapters.
 */
export const renderContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  return content
    .map((block: any) => {
      if (block == null) return "";
      if (typeof block === "string") return block;
      switch (block.type) {
        case "text":
          return block.text ?? "";
        case "tool_use": {
          const input = block.input != null ? JSON.stringify(block.input) : "";
          return `[tool_use ${block.name ?? "?"}(${input})]`;
        }
        case "tool_result": {
          const inner =
            typeof block.content === "string"
              ? block.content
              : Array.isArray(block.content)
                ? renderContent(block.content)
                : JSON.stringify(block.content ?? "");
          return `[tool_result] ${inner}`;
        }
        case "image":
          return "[image omitted]";
        default:
          try {
            return JSON.stringify(block);
          } catch {
            return String(block);
          }
      }
    })
    .filter(Boolean)
    .join("\n");
};
