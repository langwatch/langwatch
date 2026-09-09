import originalSlugify from "slugify";

/**
 * Generates a deterministic evaluator ID slug for custom SDK evaluations.
 * Produces IDs in the format `customeval_{slugified_name}`.
 *
 * The application's thirteen lines are a bare function; `service-classes`
 * requires behaviour in a service module to sit on a service class, so the rule
 * is a method and Trace's `deriveEvaluatorId` is bound to it at composition.
 *
 * This is the rule Trace's `custom-evaluation-sync` subscriber already asks for
 * by injection rather than restating — "Evaluation owns the slug rule (the same
 * one the collector and the legacy evaluations route apply)". It lives here so
 * the three callers derive one id for one name.
 *
 * THE SLUGIFY WRAPPER IS INLINED, NOT IMPORTED. The application reaches
 * `slugify` through a shared `~/utils/slugify` module that pre-replaces
 * `:`, `?`, `&` and `_` with `-` and defaults the options to
 * `{ lower: true, strict: true, replacement: "-" }`. Both halves are
 * load-bearing here: without the pre-replacement an evaluator named
 * `answer_relevancy` slugs to `answerrelevancy` instead of `answer-relevancy`,
 * and the trailing `[^a-z0-9]` pass then turns the `-` into `_`. That is a
 * different evaluator id for the same evaluation name, and nothing downstream
 * can tell the two apart — the id IS the key. The four characters and the three
 * options are pinned by literal in this module's own test. (The application
 * writes the class as `[:\?&_]`; oxlint's `no-useless-escape` drops the
 * backslash, which a character class reads identically.)
 *
 * The application's thirteen lines are a bare function; `service-classes`
 * requires behaviour in a service module to sit on a service class, so the rule
 * is a method here and Trace's injected `deriveEvaluatorId` is bound to it at
 * composition time.
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
