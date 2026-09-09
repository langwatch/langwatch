import type { ContentBlock } from "../../model/transcript/types.ts";
import { parseContentBlocks } from "./content-parser.ts";

export function reparseTextBlock(text: string): ContentBlock[] | null {
  if (!text?.includes('"type":"')) return null;
  const reparsed = parseContentBlocks(text);
  if (reparsed.some((b) => b.kind !== "text" && b.kind !== "raw")) {
    return reparsed;
  }
  return null;
}
