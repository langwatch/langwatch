/**
 * Reading the CLI's result document.
 */
import {
  asJsonDocument,
  isTruncationMarker,
  paginationSchema,
  resolveTotal,
  textValueSchema,
} from "@langwatch/langy-contract";

/**
 * Keys whose array value is the result list in a LangWatch JSON document. List
 * envelopes named after their resource (`{ experiments: [...] }`, `{ prompts: [...] }`)
 * are recognised structurally below instead of being enumerated here.
 */
const COLLECTION_KEYS = ["traces", "items", "records", "results", "data"];

/**
 * A field's text, whether the API sends it bare (`"hello"`) or in the trace
 * envelope (`{ value: "hello" }`). Undefined for anything else, including empty.
 */
export function textValue(raw: unknown): string | undefined {
  const parsed = textValueSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  return parsed.data || undefined;
}

/**
 * The rows in a document: a top-level array, or the first recognised collection key (`{
 * traces: [...] }`).
 */
function rawCollectionOf(document: unknown): unknown[] | null {
  if (Array.isArray(document)) return document;
  if (!document || typeof document !== "object") return null;

  const record = document as Record<string, unknown>;
  for (const key of COLLECTION_KEYS) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }

  // The CLI's list envelopes name the list after the resource
  // (`{ experiments: [...], pagination }`). With exactly one array-valued key
  // the list is unambiguous when the envelope is paginated or holds nothing
  // else; two arrays or an array beside other fields stays null rather than
  // a guess.
  const arrayKeys = Object.keys(record).filter((key) => Array.isArray(record[key]));
  if (arrayKeys.length === 1) {
    const onlyKey = arrayKeys[0]!;
    if ("pagination" in record || Object.keys(record).length === 1) {
      return record[onlyKey] as unknown[];
    }
  }
  return null;
}

/**
 * The rows a card draws. An oversized result is reduced upstream, which leaves a
 * marker in the array in place of the rows it removed. The marker is a record of
 * a count, not a result, so it never reaches a row: `totalOf` reads it instead.
 */
export function collectionOf(document: unknown): unknown[] | null {
  const raw = rawCollectionOf(document);
  if (!raw) return null;
  return raw.some(isTruncationMarker) ? raw.filter((row) => !isTruncationMarker(row)) : raw;
}

/**
 * A paginated document's true total, which may exceed the rows it returned.
 */
export function totalOf(document: unknown): number | null {
  if (!document || typeof document !== "object") return null;

  const { pagination } = document as { pagination?: unknown };
  const parsed = paginationSchema.safeParse(pagination);
  const stated = parsed.success ? (parsed.data.totalHits ?? parsed.data.total ?? null) : null;
  if (stated !== null) return stated;

  // No stated total. Count the array instead, and count the rows the reduction
  // removed along with the ones it kept, or a reduced list reports the size of
  // its own sample as the size of the result.
  const raw = rawCollectionOf(document);
  return raw ? resolveTotal({ rows: raw }) : null;
}

/**
 * How many things a result actually contains. An offer to act on nothing is noise, so
 * this is what gates a follow-up suggestion.
 */
export function countResults(output: unknown): number {
  const document = asJsonDocument(output);

  if (document) {
    const total = totalOf(document);
    if (total !== null) return total;

    const rows = collectionOf(document);
    if (rows) return rows.length;

    // A single resource (a `get`, a `create`) is one thing.
    return Object.keys(document as Record<string, unknown>).length > 0 ? 1 : 0;
  }

  if (typeof output === "string") {
    const text = output.trim();
    if (!text) return 0;
    if (/\bfound\s+(0|no)\b/i.test(text)) return 0;
    if (/^no\s+\w+\s+(found|matched)/i.test(text)) return 0;
    return 1;
  }
  return 0;
}
