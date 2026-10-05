import { isDeepStrictEqual } from "node:util";

import type { EvaluatorOwnSettings } from "@langwatch/evaluation-contract";

/**
 * Whether a run would set these parameters aside: the evaluator has settings
 * of its own and the parameters disagree with them. None, or a copy of the
 * evaluator's settings, is never set aside.
 */
export function areParametersUnused({
  ownSettings,
  parameters,
}: {
  ownSettings: EvaluatorOwnSettings;
  parameters: Record<string, unknown> | undefined;
}): boolean {
  if (!parameters || Object.keys(parameters).length === 0) return false;
  if (ownSettings.kind === "none") return false;

  return !isDeepStrictEqual(ownSettings.settings, parameters);
}
