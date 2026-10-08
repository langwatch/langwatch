/**
 * The evaluator id an SDK or collector evaluation naming no `evaluator_id` gets: a pure rule both
 * trace's collector and evaluation's span sync read (CI-1 precedent; T1 D3, 2026-10-08).
 */
import slugify from "slugify";

/**
 * `customeval_{slug}`. The four pre-replaced characters and the three slugify options are a wire
 * format: the derived id is the evaluator's key, so a name that slugs differently becomes two.
 */
export function deriveEvaluatorId({ name }: { name: string }): string {
  const autoslug = slugify((name || "unnamed").replaceAll(/[:?&_]/g, "-"), {
    lower: true,
    strict: true,
    replacement: "-",
  }).replace(/[^a-z0-9]/g, "_");

  return `customeval_${autoslug}`;
}
