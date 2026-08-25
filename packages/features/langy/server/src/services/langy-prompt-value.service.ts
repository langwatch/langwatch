/** Maximum context label length shared by Langy's prompt renderers. */
export const LANGY_PROMPT_VALUE_MAX_LABEL_LENGTH = 200;

/** Render untrusted client or model text as a bounded, single prompt line. */
export function sanitizeLangyPromptValue(value: string, max: number): string {
  return value
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .replace(/[`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
