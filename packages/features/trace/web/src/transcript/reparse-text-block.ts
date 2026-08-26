import type { ContentBlock } from "./types";
import { parseContentBlocks } from "./content-parser";

export function reparseTextBlock(text: string): ContentBlock[] | null {
  if (!text?.includes('"type":"')) return null;
  const reparsed = parseContentBlocks(text);
  if (reparsed.some((b) => b.kind !== "text" && b.kind !== "raw")) {
    return reparsed;
  }
  return null;
}
