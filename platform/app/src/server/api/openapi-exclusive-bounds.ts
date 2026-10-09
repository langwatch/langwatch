/**
 * The 3.1 spelling of an exclusive bound.
 *
 * The document declares `openapi: 3.1.0`, where a schema is JSON Schema
 * 2020-12 and `exclusiveMinimum` / `exclusiveMaximum` are numbers. The schema
 * builders still emit the OpenAPI 3.0 spelling: a boolean flag next to a
 * `minimum` or `maximum`. Strict validators reject it, and a client generator
 * reading it either drops the bound or errors, so a `z.number().int().positive()`
 * reached integrators as an unbounded integer.
 *
 * Applied to the merged document rather than fixed at each schema, because
 * the spelling comes from the builder and not from anything a route wrote.
 */

/** Whether the value is a plain object worth walking into. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rewrite every `exclusiveMinimum: true` / `exclusiveMaximum: true` into the
 * numeric 3.1 form, in place.
 *
 * `{ minimum: 0, exclusiveMinimum: true }` becomes `{ exclusiveMinimum: 0 }`.
 * A boolean flag with no bound beside it says nothing and is dropped; `false`
 * means "inclusive", which is what a bare `minimum` already says.
 */
export function normalizeExclusiveBounds<T>(document: T): T {
  walk(document);
  return document;
}

function walk(node: unknown): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child);
    return;
  }
  if (!isRecord(node)) return;

  normalizeBound({ node, flag: "exclusiveMinimum", bound: "minimum" });
  normalizeBound({ node, flag: "exclusiveMaximum", bound: "maximum" });

  for (const child of Object.values(node)) walk(child);
}

function normalizeBound({
  node,
  flag,
  bound,
}: {
  node: Record<string, unknown>;
  flag: "exclusiveMinimum" | "exclusiveMaximum";
  bound: "minimum" | "maximum";
}): void {
  const value = node[flag];
  if (typeof value !== "boolean") return;

  const limit = node[bound];
  if (value && typeof limit === "number") {
    node[flag] = limit;
    delete node[bound];
    return;
  }
  delete node[flag];
}
