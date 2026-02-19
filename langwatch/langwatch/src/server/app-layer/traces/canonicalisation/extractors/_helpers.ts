/**
 * Extractor Helper Functions
 *
 * This module re-exports shared utility functions used by multiple extractors.
 * It's split into specialized modules for better maintainability (SRP).
 */

export * from "./_guards";
export * from "./_messages";
export * from "./_extraction";

import { isRecord } from "./_guards";

/**
 * @deprecated Use AttributeBag.getParsed instead for memoization.
 */
export const safeJsonParse = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (s.length < 2) return v;

  const looksJson =
    (s.startsWith("{") && s.endsWith("}")) ||
    (s.startsWith("[") && s.endsWith("]"));

  if (!looksJson) return v;

  try {
    return JSON.parse(s);
  } catch {
    return v;
  }
};

/**
 * Normalizes Vercel AI SDK model object to "provider/model" string.
 * Example: { id: "gpt-4", provider: "openai.chat" } → "openai/gpt-4"
 */
export const normaliseModelFromAiModelObject = (
  aiModel: unknown,
): string | null => {
  if (!isRecord(aiModel)) return null;

  const id = (aiModel as Record<string, unknown>).id;
  if (typeof id !== "string" || id.trim().length === 0) return null;

  const providerRaw = (aiModel as Record<string, unknown>).provider;
  const provider =
    typeof providerRaw === "string" && providerRaw.trim() !== ""
      ? providerRaw.split(".")[0]
      : "";

  return [provider, id].filter(Boolean).join("/") || id;
};

export const ALLOWED_SPAN_TYPES = new Set([
  "span",
  "llm",
  "tool",
  "agent",
  "rag",
  "server",
  "client",
  "producer",
  "consumer",
]);
