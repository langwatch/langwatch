/** The per-organization switch that routes strict PII analysis to the model. */
export const PII_REDACTION_MODEL_FLAG = "release_pii_redaction_model_enabled";

/**
 * How long one model call may take: the Lambda's own 110 s timeout plus a margin, so the
 * caller never gives up on a cold start the function would still have answered.
 */
export const PII_REDACTION_MODEL_TIMEOUT_MS = 115_000;

/** AWS's ceiling for a synchronous invoke request; a larger batch stays on Presidio. */
export const LAMBDA_SYNC_INVOKE_PAYLOAD_LIMIT_BYTES = 6 * 1024 * 1024;

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
