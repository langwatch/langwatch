import {
  findRedactionMarkers,
  SECRET_MARKER_ENTITY,
} from "../../data-privacy/redaction/markers";
import {
  evaluationDurationHistogram,
  getEvaluationStatusCounter,
} from "../../metrics";
import type { SingleEvaluationResult } from "../evaluators";
import { API_KEYS_AND_SECRETS_DETECTION } from "../evaluators.native";
import { evaluateApiKeysAndSecrets } from "./apiKeysAndSecretsDetection";
import { collectStrings } from "./collectStrings";

/**
 * Run a native (in-process) evaluator. Mirrors the langevals HTTP path's
 * timing + status metrics and never throws: an executor error becomes an
 * `error` result so the calling pipeline reports it like any other.
 */
export async function executeNativeEvaluation({
  evaluatorType,
  data,
}: {
  evaluatorType: string;
  data: Record<string, unknown>;
}): Promise<SingleEvaluationResult> {
  const start = performance.now();
  try {
    let result: SingleEvaluationResult;
    switch (evaluatorType) {
      case API_KEYS_AND_SECRETS_DETECTION:
        result = evaluateApiKeysAndSecrets(data);
        break;
      default:
        result = {
          status: "error",
          error_type: "NATIVE_EVALUATOR_NOT_FOUND",
          details: `No native executor for ${evaluatorType}`,
          traceback: [],
        };
    }
    evaluationDurationHistogram
      .labels(evaluatorType)
      .observe(performance.now() - start);
    getEvaluationStatusCounter(evaluatorType, result.status).inc();
    return result;
  } catch (error) {
    getEvaluationStatusCounter(evaluatorType, "error").inc();
    return {
      status: "error",
      error_type: "NATIVE_EVALUATOR_ERROR",
      details: error instanceof Error ? error.message : String(error),
      traceback: [],
    };
  }
}

// Which redaction marker each augmentable evaluator cares about: the PII
// detector counts PII-entity markers, the secrets detector counts [SECRET].
type AugmentKind = "pii" | "secret";
const AUGMENT_KIND: Record<string, AugmentKind> = {
  "presidio/pii_detection": "pii",
  [API_KEYS_AND_SECRETS_DETECTION]: "secret",
};

/** Enabled PII entities (uppercased) from settings, or null = count every entity. */
function enabledPiiEntities(
  settings: Record<string, unknown> | undefined,
): Set<string> | null {
  const entities = settings?.entities;
  if (!entities || typeof entities !== "object") return null;
  const set = new Set<string>();
  for (const [key, value] of Object.entries(entities)) {
    if (value) set.add(key.toUpperCase());
  }
  return set;
}

/**
 * Re-add detections that ingestion redaction or drop would otherwise hide from
 * a content evaluator, so privacy enforcement never silently turns it green.
 *
 * - A value that secrets/PII redaction already replaced with a typed marker
 *   (`[SECRET]`, `[PHONE_NUMBER]`, ...) is counted back as a detection — for the
 *   PII detector, only when its settings still check that entity. Markers are
 *   matched in EVERY mapped field, so a custom span attribute the user mapped is
 *   covered just like input/output.
 * - When the evaluator's content was dropped at ingestion (nothing left to
 *   check), it fails: a leak cannot be ruled out. If the mapping instead points
 *   at another field that still has content, that content is evaluated normally
 *   and the drop is ignored.
 *
 * Errors are never touched (an operational failure must stay visible). Applies
 * to both the remote Presidio detector and the native secrets detector.
 */
export function augmentEvaluationResult({
  evaluatorType,
  mappedData,
  settings,
  droppedCategories,
  result,
}: {
  evaluatorType: string;
  mappedData: Record<string, unknown>;
  settings: Record<string, unknown> | undefined;
  droppedCategories: string[];
  result: SingleEvaluationResult;
}): SingleEvaluationResult {
  const kind = AUGMENT_KIND[evaluatorType];
  if (!kind || result.status === "error") return result;

  const texts = collectStrings(mappedData);
  const enabled = kind === "pii" ? enabledPiiEntities(settings) : null;

  let markerHits = 0;
  for (const text of texts) {
    for (const [entity, count] of findRedactionMarkers(text)) {
      if (kind === "secret") {
        if (entity === SECRET_MARKER_ENTITY) markerHits += count;
      } else if (entity !== SECRET_MARKER_ENTITY) {
        if (enabled === null || enabled.has(entity)) markerHits += count;
      }
    }
  }

  // Dropped: nothing the mapping fed the evaluator has content, yet the trace
  // dropped a content category. (A mapped non-empty attribute makes this false,
  // which is the "evaluate the other field" case.)
  const hasContent = texts.some((text) => text.trim().length > 0);
  const droppedFail = !hasContent && droppedCategories.length > 0;

  if (markerHits === 0 && !droppedFail) return result;

  const baseScore =
    result.status === "processed" && typeof result.score === "number"
      ? result.score
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
  if (droppedFail) {
    notes.push("content was dropped at ingestion and could not be checked");
  }
  const prior =
    result.status === "processed" && result.details ? `${result.details} ` : "";

  return {
    status: "processed",
    score: baseScore + markerHits + (droppedFail && markerHits === 0 ? 1 : 0),
    passed: false,
    details: `${prior}(${notes.join("; ")})`,
    ...(result.status === "processed" && result.label
      ? { label: result.label }
      : {}),
    ...(result.status === "processed" && result.cost
      ? { cost: result.cost }
      : {}),
  };
}
