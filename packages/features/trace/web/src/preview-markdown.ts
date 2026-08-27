import type { NewlineTreatment } from "./preview-types";

export interface MarkdownNoiseResult {
  text: string;
  hadCode: boolean;
  hadImage: boolean;
}

export function stripPreviewMarkdownNoise(text: string): MarkdownNoiseResult {
  let hadCode = false;
  let hadImage = false;
  const fence = /```(?:[a-zA-Z0-9_+-]*)\n([\s\S]*?)\n?```/g;
  text = text.replace(fence, (_match, body: string) => {
    hadCode = true;
    return body;
  });
  const image = /!\[([^\]]*)\]\([^)]*\)/g;
  text = text.replace(image, (_match, alt: string) => {
    hadImage = true;
    return alt.trim() ? `\u{1F4F7} ${alt.trim()}` : "\u{1F4F7}";
  });
  return { text, hadCode, hadImage };
}

export function applyPreviewNewlineTreatment(text: string, mode: NewlineTreatment): string {
  if (mode === "preserve") return text;
  if (mode === "space") return text.replace(/\s+/g, " ");
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n+\s*/g, " ↵ ")
    .trim();
}
