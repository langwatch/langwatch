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

  augment(input: EvaluatorResultAugmentationInput): SingleEvaluationResult {
    const kind = AUGMENT_KIND[input.evaluatorType];
    if (!kind || input.result.status === "error") return input.result;

    const texts = collectStrings(input.mappedData);
    const enabled = kind === "pii" ? enabledPiiEntities(input.settings) : null;
    let markerHits = 0;
    for (const text of texts) {
      for (const [entity, count] of findRedactionMarkers(text)) {
        if (kind === "secret" && entity === SECRET_MARKER_ENTITY) markerHits += count;
        if (
          kind === "pii" &&
          entity !== SECRET_MARKER_ENTITY &&
          (enabled === null || enabled.has(entity))
        ) {
          markerHits += count;
        }
      }
    }

    const hasContent = texts.some((text) => text.trim().length > 0);
    const droppedFail = !hasContent && input.droppedCategories.length > 0;
    if (markerHits === 0 && !droppedFail) return input.result;

    const baseScore =
      input.result.status === "processed" && typeof input.result.score === "number"
        ? input.result.score
        : 0;
    const noun = kind === "secret" ? "secret" : "PII";
    const notes: string[] = [];
    if (markerHits > 0) {
      notes.push(
        markerHits === 1
          ? `1 ${noun} value was already redacted at ingestion`
          : `${markerHits} ${noun} values were already redacted at ingestion`,
      );
    }
    if (droppedFail) notes.push("content was dropped at ingestion and could not be checked");
    const prior =
      input.result.status === "processed" && input.result.details ? `${input.result.details} ` : "";
    return {
      status: "processed",
      score: baseScore + markerHits + (droppedFail && markerHits === 0 ? 1 : 0),
      passed: false,
      details: `${prior}(${notes.join("; ")})`,
      ...(input.result.status === "processed" && input.result.label
        ? { label: input.result.label }
        : {}),
      ...(input.result.status === "processed" && input.result.cost
        ? { cost: input.result.cost }
        : {}),
    };
  }
}
