/**
 * Flatten every string value out of a mapped evaluation-data record, walking
 * nested objects and arrays, so a detector can scan whatever the mapping fed the
 * evaluator regardless of which field (input, output, contexts, or an arbitrary
 * mapped span attribute) it landed in. Bounded so a pathological payload cannot
 * blow up the evaluation.
 */
const MAX_STRINGS = 5_000;
const MAX_DEPTH = 8;

function walkStringArray(items: unknown[], depth: number, out: string[]): void {
  for (const item of items) walkStringNode(item, depth + 1, out);
}

function walkStringObject(node: object, depth: number, out: string[]): void {
  for (const item of Object.values(node)) walkStringNode(item, depth + 1, out);
}

function walkStringNode(node: unknown, depth: number, out: string[]): void {
  if (out.length >= MAX_STRINGS || depth > MAX_DEPTH) return;
  if (typeof node === "string") {
    out.push(node);
    return;
  }
  if (Array.isArray(node)) {
    walkStringArray(node, depth, out);
    return;
  }
  if (node && typeof node === "object") {
    walkStringObject(node, depth, out);
  }
}

export function collectStrings(value: unknown): string[] {
  const out: string[] = [];
  walkStringNode(value, 0, out);
  return out;
}
