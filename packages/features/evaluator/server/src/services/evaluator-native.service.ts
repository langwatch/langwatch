import {
  API_KEYS_AND_SECRETS_DETECTION,
  type EvaluatorResultAugmentationInput,
  type NativeEvaluatorExecutionInput,
  type SingleEvaluationResult,
} from "@langwatch/evaluator-contract";
import {
  detectSecretsInText,
  findRedactionMarkers,
  SECRET_MARKER_ENTITY,
} from "@langwatch/redaction";

const MAX_STRINGS = 5_000;
const MAX_DEPTH = 8;

function collectStrings(value: unknown): string[] {
  const values: string[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (values.length >= MAX_STRINGS || depth > MAX_DEPTH) return;
    if (typeof node === "string") {
      values.push(node);
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
  return values;
}

function evaluateApiKeysAndSecrets(data: Record<string, unknown>): SingleEvaluationResult {
  const matches = collectStrings(data).flatMap((text) => detectSecretsInText({ text }));
  if (matches.length === 0) return { status: "processed", score: 0, passed: true };

  const byRule = new Map<string, number>();
  for (const match of matches) {
    byRule.set(match.ruleId, (byRule.get(match.ruleId) ?? 0) + 1);
  }
  const summary = [...byRule.entries()].map(([rule, count]) => `${rule} (${count})`).join(", ");
  return {
    status: "processed",
    score: matches.length,
    passed: false,
    details: `Detected ${matches.length} secret${matches.length === 1 ? "" : "s"}: ${summary}`,
  };
}

type AugmentKind = "pii" | "secret";
const AUGMENT_KIND: Record<string, AugmentKind> = {
  "presidio/pii_detection": "pii",
  [API_KEYS_AND_SECRETS_DETECTION]: "secret",
};

function enabledPiiEntities(settings: Record<string, unknown> | undefined): Set<string> | null {
  const entities = settings?.entities;
  if (!entities || typeof entities !== "object") return null;
  const enabled = new Set<string>();
  for (const [key, value] of Object.entries(entities)) {
    if (value) enabled.add(key.toUpperCase());
  }
  return enabled;
}

export class EvaluatorNativeService {
  static create(): EvaluatorNativeService {
    return new EvaluatorNativeService();
  }

  private constructor() {}

  async execute(input: NativeEvaluatorExecutionInput): Promise<SingleEvaluationResult> {
    try {
      if (input.evaluatorType === API_KEYS_AND_SECRETS_DETECTION) {
        return evaluateApiKeysAndSecrets(input.data);
      }
      return {
        status: "error",
        error_type: "NATIVE_EVALUATOR_NOT_FOUND",
        details: `No native executor for ${input.evaluatorType}`,
        traceback: [],
      };
    } catch (error) {
      return {
        status: "error",
        error_type: "NATIVE_EVALUATOR_ERROR",
        details: error instanceof Error ? error.message : String(error),
        traceback: [],
      };
    }
  }

  /**
   * Re-fails a passing result when the content it judged had already been
   * redacted, or was dropped, at ingestion.
   *
   * An evaluator that sees `<PERSON>` where a name was finds no PII and passes,
   * which is the wrong answer about the trace: the PII was there, ingestion took
   * it out. The same holds for content dropped entirely.
   */
  augment(input: EvaluatorResultAugmentationInput): SingleEvaluationResult {
    const kind = AUGMENT_KIND[input.evaluatorType];
    if (!kind || input.result.status === "error") return input.result;

    const texts = collectStrings(input.mappedData);
    const markerHits = this.countRedactedValues(kind, texts, input.settings);
    const hasContent = texts.some((text) => text.trim().length > 0);
    const droppedFail = !hasContent && input.droppedCategories.length > 0;
    if (markerHits === 0 && !droppedFail) return input.result;

    return this.reFailed(input, markerHits, droppedFail, kind);
  }

  /**
   * How many values of this kind the redaction pass already took out.
   *
   * A secret evaluator counts only the secret marker; a PII evaluator counts
   * every other entity, narrowed to the ones its settings enable — absent
   * settings mean all of them.
   */
  private countRedactedValues(
    kind: AugmentKind,
    texts: string[],
    settings: Record<string, unknown> | undefined,
  ): number {
    const enabled = kind === "pii" ? enabledPiiEntities(settings) : null;
    let hits = 0;
    for (const text of texts) {
      for (const [entity, count] of findRedactionMarkers(text)) {
        const isSecret = entity === SECRET_MARKER_ENTITY;
        if (kind === "secret" && isSecret) hits += count;
        if (kind === "pii" && !isSecret && (enabled === null || enabled.has(entity))) {
          hits += count;
        }
      }
    }
    return hits;
  }

  /** The failing result, with the original's own details kept in front. */
  private reFailed(
    input: EvaluatorResultAugmentationInput,
    markerHits: number,
    droppedFail: boolean,
    kind: AugmentKind,
  ): SingleEvaluationResult {
    const processed = input.result.status === "processed" ? input.result : null;
    const baseScore = typeof processed?.score === "number" ? processed.score : 0;
    const prior = processed?.details ? `${processed.details} ` : "";
    const notes = this.notesFor(markerHits, droppedFail, kind === "secret" ? "secret" : "PII");

    return {
      status: "processed",
      // A drop with no markers still has to move the score off zero, or a
      // passing result would come back with nothing to show for the re-fail.
      score: baseScore + markerHits + (droppedFail && markerHits === 0 ? 1 : 0),
      passed: false,
      details: `${prior}(${notes.join("; ")})`,
      ...(processed?.label ? { label: processed.label } : {}),
      ...(processed?.cost ? { cost: processed.cost } : {}),
    };
  }

  private notesFor(markerHits: number, droppedFail: boolean, noun: string): string[] {
    const notes: string[] = [];
    if (markerHits === 1) {
      notes.push(`1 ${noun} value was already redacted at ingestion`);
    } else if (markerHits > 1) {
      notes.push(`${markerHits} ${noun} values were already redacted at ingestion`);
    }
    if (droppedFail) notes.push("content was dropped at ingestion and could not be checked");
    return notes;
  }
}
