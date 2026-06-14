import { Liquid } from "liquidjs";

const liquid = new Liquid();

export interface LiquidConditionValidation {
  /** A syntax error message, present when the condition does not parse. */
  error?: string;
  /** Variables referenced by the condition that are not declared inputs. */
  missingVariables: string[];
}

/**
 * Wraps the bare condition in a Liquid `{% if %}` so liquidjs parses it the
 * same way the engine does, then reports two problems the if/else condition
 * input otherwise swallows silently:
 *
 *  - syntax errors (an unbalanced or malformed expression), and
 *  - references to variables that are not among the node's declared inputs.
 *
 * An empty condition is treated as valid so the field does not nag while it
 * is being typed. Variable extraction is best-effort: anything liquidjs
 * cannot analyze yields no missing-variable warnings rather than a false
 * alarm.
 */
export function validateLiquidCondition(
  condition: string,
  availableVariables: string[],
): LiquidConditionValidation {
  if (condition.trim() === "") {
    return { missingVariables: [] };
  }

  const wrapped = `{% if ${condition} %}x{% endif %}`;

  try {
    liquid.parse(wrapped);
  } catch (e) {
    return { error: cleanLiquidError(e), missingVariables: [] };
  }

  let referenced: string[] = [];
  try {
    referenced = liquid.variablesSync(wrapped);
  } catch {
    referenced = [];
  }

  const known = new Set(availableVariables);
  const missingVariables = referenced.filter((v) => !known.has(v));
  return { missingVariables };
}

/**
 * liquidjs errors carry a `, line:N, col:N` suffix and a multi-line code
 * frame keyed to the wrapped template, which would leak the `{% if %}`
 * wrapper into the message. Keep just the human-readable reason.
 */
function cleanLiquidError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const firstLine = message.split("\n")[0] ?? message;
  return firstLine.replace(/,\s*line:\d+,\s*col:\d+.*$/, "").trim();
}
