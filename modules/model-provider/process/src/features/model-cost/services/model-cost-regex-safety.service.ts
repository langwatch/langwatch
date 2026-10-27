/**
 * Whether a customer-written cost-rule pattern is safe to run.
 */
import safe from "safe-regex2";

export class ModelCostRegexSafetyService {
  static create(): ModelCostRegexSafetyService {
    return new ModelCostRegexSafetyService();
  }

  private constructor() {}

  /**
   * Compiles a pattern, and only one that is free of catastrophic backtracking.
   * Throws when the pattern is invalid OR unsafe — both mean "do not run this",
   * and a caller that wants only the verdict asks {@link isSafeRegex}.
   */
  compileSafeRegex(pattern: string): RegExp {
    const compiled = new RegExp(pattern);
    if (!safe(compiled)) {
      throw new Error("Cost-rule pattern can backtrack catastrophically");
    }

    return compiled;
  }

  /** The pass/fail verdict, for call sites that do not need the compiled form. */
  isSafeRegex(pattern: string): boolean {
    try {
      this.compileSafeRegex(pattern);

      return true;
    } catch {
      return false;
    }
  }
}
