import { getLiquidEngine } from "./engine";
import { errorMessage } from "./renderWithFallback";

export interface LiquidValidationResult {
  valid: boolean;
  /** Human-readable syntax error, set only when `valid` is false. */
  error?: string;
}

/**
 * Validates Liquid template syntax. Run on every non-null template column when
 * a Trigger is saved (Hono + tRPC) so a malformed template is rejected at save
 * time rather than silently falling back to the default at dispatch time.
 */
export function validateLiquid(template: string): LiquidValidationResult {
  try {
    getLiquidEngine().parse(template);
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: errorMessage(err),
    };
  }
}
