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
   * Compiles a pattern and returns it only when it is free of catastrophic
   * backtracking. Null when the pattern is invalid OR unsafe — the caller cannot
   * tell the two apart, and does not need to: both mean "do not run this".
   */
  compileSafeRegex(pattern: string): RegExp | null {
    try {
      const compiled = new RegExp(pattern);

      return safe(compiled) ? compiled : null;
    } catch {
      return null;
    }
  }

  /** The pass/fail verdict, for call sites that do not need the compiled form. */
  isSafeRegex(pattern: string): boolean {
    return this.compileSafeRegex(pattern) !== null;
  }
}
