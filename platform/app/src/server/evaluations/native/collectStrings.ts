/**
 * Flatten every string value out of a mapped evaluation-data record, walking
 * nested objects and arrays, so a detector can scan whatever the mapping fed the
 * evaluator regardless of which field (input, output, contexts, or an arbitrary
 * mapped span attribute) it landed in. Bounded so a pathological payload cannot
 * blow up the evaluation.
 */
const MAX_STRINGS = 5_000;
const MAX_DEPTH = 8;

export function collectStrings(value: unknown): string[] {
  const out: string[] = [];

  const walk = (node: unknown, depth: number): void => {
    if (out.length >= MAX_STRINGS || depth > MAX_DEPTH) return;
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (node && typeof node === "object") {
      for (const item of Object.values(node)) walk(item, depth + 1);
    }
  };

  walk(value, 0);
  return out;
}
