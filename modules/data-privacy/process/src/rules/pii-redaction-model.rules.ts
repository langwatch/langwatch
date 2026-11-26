/** The per-organization switch that routes strict PII analysis to the model. */
export const PII_REDACTION_MODEL_FLAG = "release_pii_redaction_model_enabled";

/** The organizations whose model calls are recorded at a price of zero (ADR-201 decision 7). */
export const PII_REDACTION_MODEL_FREE_FLAG = "release_pii_redaction_model_free";

/**
 * When a model call is aborted and its batch goes to Presidio. The two calls share no budget:
 * Presidio then gets its own 60 s timer, so a batch can wait up to 110 s before Google DLP.
 * A cold start falls back.
 */
export const PII_REDACTION_MODEL_TIMEOUT_MS = 50_000;

/**
 * After a model call times out or is throttled, this process sends every routed batch straight
 * to Presidio for this long; then one batch tries the model again. Without it a slow model costs
 * every batch the full time cap, one after another.
 */
export const PII_REDACTION_MODEL_BREAKER_COOLDOWN_MS = 2 * 60_000;

/** A function ARN, optionally qualified by an alias or version; the region is the fourth field. */
const LAMBDA_FUNCTION_ARN =
  /^arn:aws[a-z-]*:lambda:([a-z0-9-]+):\d{12}:function:[\w-]+(?::[\w$-]+)?$/;

/** Where the model is reached, read from its one deployment setting. */
export type PiiRedactionModelTarget =
  | Readonly<{ kind: "lambda"; functionArn: string; region: string }>
  | Readonly<{ kind: "http"; endpoint: string }>
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "invalid"; reason: string }>;

/**
 * Reads PII_REDACTION_MODEL_ENDPOINT: an `arn:` value is the model's Lambda (alias) ARN, invoked
 * with the pod's role; anything else is its HTTP address; empty names no model.
 */
export function piiRedactionModelTargetOf(setting: string | undefined): PiiRedactionModelTarget {
  const value = setting?.trim();
  if (!value) return { kind: "none" };

  if (value.startsWith("arn:")) {
    const region = LAMBDA_FUNCTION_ARN.exec(value)?.[1];
    if (!region) {
      return {
        kind: "invalid",
        reason: "PII_REDACTION_MODEL_ENDPOINT is an ARN but not a Lambda function ARN",
      };
    }
    return { kind: "lambda", functionArn: value, region };
  }

  return { kind: "http", endpoint: value.replace(/\/+$/, "") };
}

/** All the characters one batch would send. */
export function batchCharactersOf(texts: readonly string[]): number {
  return texts.reduce((total, text) => total + text.length, 0);
}

/** The failure's class name only: a refusal's message may quote the analysed text. */
export function failureName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/** A timeout or a throttle means the model is unavailable now; anything else is a refusal. */
export function failureOutcomeOf(error: unknown): "timeout" | "throttled" | "error" {
  if (isTimeout(error)) return "timeout";
  if (isThrottled(error)) return "throttled";
  return "error";
}

/** An abort at the time cap: the Lambda SDK and fetch both name it AbortError. */
function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

/** Lambda's own throttle, which the SDK names after the error code since it is not retried. */
function isThrottled(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TooManyRequestsException" || error.name === "ThrottlingException")
  );
}
