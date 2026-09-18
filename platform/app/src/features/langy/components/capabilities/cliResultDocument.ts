/**
 * Reading the CLI's result document.
 *
 * Every LangWatch CLI read runs with `--format json`, and the server's CLI
 * envelope lifts that document out of the console noise before recording it — so
 * a settled tool call carries a JSON document as a string (a string all the way to
 * the browser, because that is what an AI-SDK tool output is).
 *
 * This module used to duck-type that document: it guessed which key held the rows,
 * guessed how the total was spelled, and tolerated everything because it had no
 * contract with the producer. It has one now. `@langwatch/langy` is the shared
 * package the CLI publishes its result shapes in and the panel reads them back
 * with, so the shape is stated ONCE and both ends compile against it.
 *
 * What remains here is the panel's own view logic — how many things a result holds,
 * which rows to draw — expressed on top of that contract rather than instead of it.
 *
 * Still tolerant by design: a shape the contract does not recognise returns
 * null/undefined rather than a guess, so a drifted CLI degrades to "no card detail"
 * and never to a wrong one.
 */
import {
  asJsonDocument,
  paginationSchema,
  textValueSchema,
} from "@langwatch/langy";

/** Keys whose array value is the result list in a LangWatch JSON document. */
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
 * The rows in a document: a top-level array, or the first recognised collection
 * key (`{ traces: [...] }`). Null when the document holds no collection — which is
 * different from an EMPTY one, and the difference is the whole point: an empty list
 * is the honest answer "nothing matched".
 */
export function collectionOf(document: unknown): unknown[] | null {
  if (Array.isArray(document)) return document;
  if (!document || typeof document !== "object") return null;

  const record = document as Record<string, unknown>;
  for (const key of COLLECTION_KEYS) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return null;
}

/**
 * A paginated document's true total, which may exceed the rows it returned.
 *
 * The platform counts two ways — `totalHits` for traces, `total` for the paged
 * REST collections — and reconciling them is the shared contract's job, not this
 * module's.
 */
export function totalOf(document: unknown): number | null {
  if (!document || typeof document !== "object") return null;

  const { pagination } = document as { pagination?: unknown };
  const parsed = paginationSchema.safeParse(pagination);
  if (!parsed.success) return null;

  return parsed.data.totalHits ?? parsed.data.total ?? null;
}

/**
 * How many things a result actually contains. An offer to act on nothing is noise,
 * so this is what gates a follow-up suggestion.
 *
 * A structured document answers exactly; unstructured text can only be read for the
 * "found nothing" tell, and is otherwise assumed to carry something.
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
