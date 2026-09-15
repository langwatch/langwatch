import originalSlugify from "slugify";

/**
 * Deterministic evaluator ID slugs in format `customeval_{slugified_name}`;
 * slugify wrapper inlined with load-bearing options per module test.
 */
export class EvaluationNameAutoslugService {
  static create(): EvaluationNameAutoslugService {
    return new EvaluationNameAutoslugService();
  }

  private constructor() {}

  derive(name: string): string {
    const autoslug = originalSlugify((name || "unnamed").replaceAll(/[:?&_]/g, "-"), {
      lower: true,
      strict: true,
      replacement: "-",
    }).replace(/[^a-z0-9]/g, "_");

    return `customeval_${autoslug}`;
  }
}
