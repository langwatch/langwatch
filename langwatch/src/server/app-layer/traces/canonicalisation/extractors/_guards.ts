/**
 * Type guard for plain objects (non-null, non-array objects).
 */
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

/**
 * Type guard for message-like objects.
 */
export interface MessageLike {
  role?: string;
  content?: unknown;
  [key: string]: unknown;
}

export const isMessageLike = (v: unknown): v is MessageLike =>
  isRecord(v) &&
  (typeof (v as MessageLike).role === "string" ||
    (v as MessageLike).role === undefined);

export const asNumber = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "bigint") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

export const coerceToStringArray = (v: unknown): string[] | null => {
  if (v == null) return null;
  const xs = Array.isArray(v) ? v : [v];
  const out = xs.map(String).filter((s) => s.length > 0);
  return out.length ? out : null;
};

/**
 * Best-effort JSON parse for edge cases where a value might still be
 * a JSON string (e.g., event attributes that bypass normalization).
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
