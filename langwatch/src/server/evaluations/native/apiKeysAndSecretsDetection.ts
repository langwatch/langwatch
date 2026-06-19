import { detectSecretsInText } from "../../data-privacy/redaction/secretsRedaction";
import type { SingleEvaluationResult } from "../evaluators";
import { collectStrings } from "./collectStrings";

/**
 * Native executor for `langwatch/api_keys_and_secrets_detection`. Runs the same
 * detection rules the secrets-redaction engine uses, over every string the
 * mapping fed the evaluator, and reports a leak when any built-in credential
 * pattern matches. This is the LIVE pass only: a secret that ingestion redaction
 * already replaced with a `[SECRET]` marker is added back by the shared
 * augmenter (see registry.ts), so redaction never hides a leak from the result.
 */
export function evaluateApiKeysAndSecrets(
  data: Record<string, unknown>,
): SingleEvaluationResult {
  const texts = collectStrings(data);
  const matches = texts.flatMap((text) => detectSecretsInText({ text }));

  if (matches.length === 0) {
    return { status: "processed", score: 0, passed: true };
  }

  const byRule = new Map<string, number>();
  for (const match of matches) {
    byRule.set(match.ruleId, (byRule.get(match.ruleId) ?? 0) + 1);
  }
  const summary = [...byRule.entries()]
    .map(([rule, count]) => `${rule} (${count})`)
    .join(", ");

  return {
    status: "processed",
    score: matches.length,
    passed: false,
    details: `Detected ${matches.length} secret${
      matches.length === 1 ? "" : "s"
    }: ${summary}`,
  };
}
