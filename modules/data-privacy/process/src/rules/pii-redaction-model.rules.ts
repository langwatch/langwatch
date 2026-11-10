/** The per-organization switch that routes strict PII analysis to the model. */
export const PII_REDACTION_MODEL_FLAG = "release_pii_redaction_model_enabled";

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

/** Where the model is reached, read from the two deployment settings. */
export type PiiRedactionModelTarget =
  | Readonly<{ kind: "lambda"; functionArn: string; region: string }>
  | Readonly<{ kind: "http"; endpoint: string }>
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "invalid"; reason: string }>;

/** The Lambda alias wins over the address when both are set, as the NLP fleet wins over its URL. */
export function piiRedactionModelTargetOf({
  lambdaArn,
  endpoint,
}: {
  lambdaArn: string | undefined;
  endpoint: string | undefined;
}): PiiRedactionModelTarget {
  const functionArn = lambdaArn?.trim();
  if (functionArn) {
    const region = LAMBDA_FUNCTION_ARN.exec(functionArn)?.[1];
    if (!region) {
      return {
        kind: "invalid",
        reason: "PII_REDACTION_MODEL_LAMBDA_ARN is not a Lambda function ARN",
      };
    }
    return { kind: "lambda", functionArn, region };
  }

  const address = endpoint?.trim();
  if (address) return { kind: "http", endpoint: address.replace(/\/+$/, "") };

  return { kind: "none" };
}

/** All the characters one batch would send. */
export function batchCharactersOf(texts: readonly string[]): number {
  return texts.reduce((total, text) => total + text.length, 0);
}

/**
 * Above this many characters in a batch's texts, it goes to Presidio, never split: time grows with
 * every character (4 s for 2k, 40 to 56 s for 20k). It also keeps each invoke far under Lambda's
 * 6 MB synchronous limit, so the channel does not check that limit.
 */
export const PII_REDACTION_MODEL_MAX_BATCH_CHARACTERS = 8_000;

/** Whether a batch is too long for the model to answer inside its time cap. */
export function isBatchTooLongForModel(texts: readonly string[]): boolean {
  return batchCharactersOf(texts) > PII_REDACTION_MODEL_MAX_BATCH_CHARACTERS;
}
